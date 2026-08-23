#!/usr/bin/env python3
"""Telegram-бот: мониторинг свободных талонов на zdrav.mosreg.ru."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

from storage import Storage, Subscription
from zdrav_client import (
    BOOKING_URL,
    DEFAULT_DAYS,
    DoctorsQuery,
    Polis,
    ZdravClient,
    available_slots,
    collect_doctors,
    collect_hospitals,
    fingerprint,
    format_slots,
    subscription_key,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("zdrav-bot")

DATA_DIR = Path(__file__).resolve().parent / "data"
STORAGE = Storage(DATA_DIR / "users.json")

CHECK_INTERVAL_SEC = int(os.getenv("CHECK_INTERVAL_SEC", "300"))
DAYS = int(os.getenv("DAYS", str(DEFAULT_DAYS)))


def _client_for_user(user) -> ZdravClient:
    polis = Polis(number=user.polis_number, birthday=user.polis_birthday)
    return ZdravClient(polis, days=DAYS)


async def _run_sync(func, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


HELP_TEXT = (
    "🏥 *Монитор записи к врачу* (Подмосковье)\n\n"
    "Бот проверяет zdrav.mosreg.ru каждые "
    f"{CHECK_INTERVAL_SEC // 60} мин. и пишет, когда появляются талоны.\n\n"
    "*Команды:*\n"
    "/polis номер дата — указать полис и дату рождения\n"
    "  _пример:_ `/polis 5040200838017611 01.12.2000`\n"
    "/departments — выбрать специальность\n"
    "/list — ваши подписки\n"
    "/check — проверить прямо сейчас\n"
    "/me — ваши данные\n"
    "/unfollow номер — удалить подписку\n"
    "/delete — удалить все ваши данные\n"
    "/help — эта справка\n\n"
    "⚠️ Неофициальный бот. Только читает расписание, запись не создаёт.\n"
    "Запускайте на ПК/VPS в РФ."
)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(HELP_TEXT, parse_mode="Markdown")


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await start(update, context)


async def polis_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    text = update.message.text or ""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await update.message.reply_text(
            "Формат:\n"
            "`/polis 5040200838017611 01.12.2000`\n\n"
            "Пробелы и дефисы в номере полиса можно не убирать.",
            parse_mode="Markdown",
        )
        return

    tokens = parts[1].replace("-", " ").split()
    if len(tokens) < 2:
        await update.message.reply_text("Укажите номер полиса и дату рождения ДД.ММ.ГГГГ")
        return

    birthday = tokens[-1]
    number_raw = "".join(tokens[:-1])
    try:
        polis = Polis.parse(number_raw, birthday)
    except ValueError as exc:
        await update.message.reply_text(f"❌ {exc}")
        return

    await update.message.reply_text("Проверяю полис на портале…")
    client = ZdravClient(polis, days=DAYS)
    try:
        auth = await _run_sync(client.auth)
    except Exception as exc:  # noqa: BLE001
        await update.message.reply_text(f"❌ Ошибка авторизации:\n{exc}")
        return

    attached = []
    for lpu in auth.get("lpu") or []:
        attached.append(
            {
                "code": str(lpu.get("code") or ""),
                "title": lpu.get("title") or lpu.get("full_name") or "",
                "city": lpu.get("city") or "",
                "address": lpu.get("fullAddress") or "",
            }
        )

    STORAGE.set_polis(
        chat_id,
        polis.number,
        polis.birthday,
        person_guid=str(auth.get("personGuid") or ""),
        attached_lpus=attached,
    )

    lines = [
        "✅ Полис сохранён.",
        f"personGuid: `{auth.get('personGuid')}`",
        "",
        "Прикрепления:",
    ]
    if attached:
        for lpu in attached[:8]:
            city = lpu.get("city") or ""
            lines.append(f"• {lpu['title']} (код {lpu['code']}) {city}")
    else:
        lines.append("• (не найдены — проверьте прикрепление к МО)")
    lines.append("")
    lines.append("Дальше: /departments")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def me_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = STORAGE.get_user(update.effective_chat.id)
    if not user.has_polis():
        await update.message.reply_text("Полис не указан. Команда: /polis")
        return
    lines = [
        f"Полис: `{user.polis_number}`",
        f"Дата рождения: `{user.polis_birthday}`",
        f"Подписок: {len(user.subscriptions)}",
    ]
    if user.attached_lpus:
        lines.append("")
        lines.append("Прикрепления:")
        for lpu in user.attached_lpus[:5]:
            lines.append(f"• {lpu.get('title')} ({lpu.get('code')})")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def departments_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    user = STORAGE.get_user(chat_id)
    if not user.has_polis():
        await update.message.reply_text("Сначала укажите полис: /polis")
        return

    await update.message.reply_text("Загружаю специальности…")
    client = _client_for_user(user)
    try:
        await _run_sync(client.auth)
        items = await _run_sync(client.departments)
    except Exception as exc:  # noqa: BLE001
        await update.message.reply_text(f"❌ {exc}")
        return

    if not items:
        await update.message.reply_text("Специальности не найдены.")
        return

    buttons = []
    for item in items[:40]:
        title = item.get("title") or "?"
        dept_id = item.get("id") or ""
        label = title[:40]
        buttons.append(
            [InlineKeyboardButton(label, callback_data=f"d:{dept_id}")]
        )

    await update.message.reply_text(
        f"Выберите специальность ({len(items)}):",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def on_department(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    dept_id = query.data.split(":", 1)[1]
    chat_id = update.effective_chat.id
    user = STORAGE.get_user(chat_id)
    if not user.has_polis():
        await query.edit_message_text("Сначала /polis")
        return

    client = _client_for_user(user)
    try:
        await _run_sync(client.auth)
        payload = await _run_sync(
            client.doctors, DoctorsQuery(department_id=dept_id, days=DAYS)
        )
        hospitals = collect_hospitals(payload)
        dept_title = next(
            (
                item.get("title")
                for item in await _run_sync(client.departments)
                if item.get("id") == dept_id
            ),
            dept_id,
        )
    except Exception as exc:  # noqa: BLE001
        await query.edit_message_text(f"❌ {exc}")
        return

    context.user_data["dept_id"] = dept_id
    context.user_data["dept_title"] = dept_title

    if not hospitals:
        await query.edit_message_text("Больницы не найдены для этой специальности.")
        return

    buttons = []
    for h in hospitals[:30]:
        label = f"{h['name'][:28]} ({h['code']})"
        buttons.append(
            [
                InlineKeyboardButton(
                    label,
                    callback_data=f"h:{dept_id}:{h['code']}",
                )
            ]
        )

    await query.edit_message_text(
        f"🏥 *{dept_title}*\nВыберите поликлинику:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def on_hospital(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    _, dept_id, lpu_code = query.data.split(":", 2)
    chat_id = update.effective_chat.id
    user = STORAGE.get_user(chat_id)
    dept_title = context.user_data.get("dept_title", dept_id)

    client = _client_for_user(user)
    try:
        await _run_sync(client.auth)
        payload = await _run_sync(
            client.doctors,
            DoctorsQuery(department_id=dept_id, lpu_code=lpu_code, days=DAYS),
        )
        doctors = collect_doctors(payload)
        hospitals = collect_hospitals(payload)
        lpu_name = next((h["name"] for h in hospitals if h["code"] == lpu_code), lpu_code)
    except Exception as exc:  # noqa: BLE001
        await query.edit_message_text(f"❌ {exc}")
        return

    context.user_data["lpu_code"] = lpu_code
    context.user_data["lpu_name"] = lpu_name

    lines = [f"🏥 {lpu_name}", f"Специальность: {dept_title}", ""]
    buttons = [
        [
            InlineKeyboardButton(
                "🔔 Подписаться на всех врачей",
                callback_data=f"f:{dept_id}:{lpu_code}:ALL",
            )
        ]
    ]

    if not doctors:
        lines.append("Врачи не найдены.")
    else:
        lines.append("Врачи (сейчас свободных талонов):")
        for doc in doctors[:15]:
            lines.append(f"• {doc['display_name']} — {doc['tickets']}")
            short_id = doc["id"][-12:]
            buttons.append(
                [
                    InlineKeyboardButton(
                        f"🔔 {doc['display_name'][:24]} ({doc['tickets']})",
                        callback_data=f"f:{dept_id}:{lpu_code}:{short_id}",
                    )
                ]
            )

    await query.edit_message_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def on_follow(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    _, dept_id, lpu_code, doc_token = query.data.split(":", 3)
    chat_id = update.effective_chat.id
    user = STORAGE.get_user(chat_id)
    dept_title = context.user_data.get("dept_title", dept_id)
    lpu_name = context.user_data.get("lpu_name", lpu_code)

    doctor_id = ""
    doctor_name = "Все врачи"
    if doc_token != "ALL":
        client = _client_for_user(user)
        try:
            await _run_sync(client.auth)
            payload = await _run_sync(
                client.doctors,
                DoctorsQuery(department_id=dept_id, lpu_code=lpu_code, days=DAYS),
            )
            for doc in collect_doctors(payload):
                if doc["id"].endswith(doc_token):
                    doctor_id = doc["id"]
                    doctor_name = doc["display_name"]
                    break
            if not doctor_id:
                await query.edit_message_text("Врач не найден, попробуйте снова /departments")
                return
        except Exception as exc:  # noqa: BLE001
            await query.edit_message_text(f"❌ {exc}")
            return

    dq = DoctorsQuery(
        department_id=dept_id,
        lpu_code=lpu_code,
        doctor_id=doctor_id,
        days=DAYS,
    )
    sub = Subscription(
        id=subscription_key(dq),
        department_id=dept_id,
        department_title=dept_title,
        lpu_code=lpu_code,
        lpu_name=lpu_name,
        doctor_id=doctor_id,
        doctor_name=doctor_name,
    )
    STORAGE.add_subscription(chat_id, sub)

    await query.edit_message_text(
        "✅ Подписка создана!\n\n"
        f"Специальность: {dept_title}\n"
        f"Поликлиника: {lpu_name}\n"
        f"Врач: {doctor_name}\n\n"
        f"Проверка каждые {CHECK_INTERVAL_SEC // 60} мин.\n"
        "Команды: /list /check",
    )


async def list_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = STORAGE.get_user(update.effective_chat.id)
    if not user.subscriptions:
        await update.message.reply_text(
            "Подписок нет. Создайте через /departments"
        )
        return
    lines = ["📋 *Ваши подписки:*", ""]
    for idx, sub in enumerate(user.subscriptions, start=1):
        lines.append(f"*{idx}.* {sub.department_title}")
        lines.append(f"   🏥 {sub.lpu_name} ({sub.lpu_code})")
        lines.append(f"   👨‍⚕️ {sub.doctor_name or 'Все врачи'}")
        lines.append(f"   Последняя проверка: {sub.last_total} талонов")
        lines.append("")
    lines.append("Удалить: `/unfollow 1`")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def unfollow_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    user = STORAGE.get_user(chat_id)
    match = re.search(r"\d+", update.message.text or "")
    if not match or not user.subscriptions:
        await update.message.reply_text("Формат: /unfollow 1  (номер из /list)")
        return
    idx = int(match.group()) - 1
    if idx < 0 or idx >= len(user.subscriptions):
        await update.message.reply_text("Неверный номер. Смотрите /list")
        return
    removed = user.subscriptions[idx]
    STORAGE.remove_subscription(chat_id, removed.id)
    await update.message.reply_text(f"🗑 Подписка удалена: {removed.department_title}")


async def delete_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    STORAGE.clear_user(update.effective_chat.id)
    await update.message.reply_text("🗑 Все ваши данные удалены из бота.")


async def check_subscription(
    user,
    sub: Subscription,
    *,
    force: bool = False,
) -> tuple[bool, str, int]:
    client = _client_for_user(user)
    await _run_sync(client.auth)
    payload = await _run_sync(
        client.doctors,
        DoctorsQuery(
            department_id=sub.department_id,
            lpu_code=sub.lpu_code,
            doctor_id=sub.doctor_id,
            days=DAYS,
        ),
    )
    slots = available_slots(payload, sub.doctor_id)
    total = sum(s["count_tickets"] for s in slots)
    fp = fingerprint(slots)

    notify = force or (
        total > 0 and (total > sub.last_total or fp != sub.fingerprint)
    )
    text = ""
    if notify and total > 0:
        title = f"Талоны: {sub.department_title}"
        if sub.doctor_name and sub.doctor_name != "Все врачи":
            title += f" — {sub.doctor_name}"
        text = format_slots(slots, title=title, booking_url=BOOKING_URL)

    STORAGE.update_subscription_state(
        user.chat_id, sub.id, last_total=total, fingerprint=fp
    )
    return notify, text, total


async def check_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = STORAGE.get_user(update.effective_chat.id)
    if not user.has_polis():
        await update.message.reply_text("Сначала /polis")
        return
    if not user.subscriptions:
        await update.message.reply_text("Нет подписок. /departments")
        return

    await update.message.reply_text("Проверяю…")
    found_any = False
    for sub in list(user.subscriptions):
        try:
            notify, text, total = await check_subscription(user, sub, force=True)
            if notify and text:
                found_any = True
                await update.message.reply_text(text)
            elif total == 0:
                pass
        except Exception as exc:  # noqa: BLE001
            await update.message.reply_text(f"❌ {sub.department_title}: {exc}")
            return

    if not found_any:
        await update.message.reply_text("Сейчас свободных талонов по подпискам нет.")


async def monitor_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    pairs = STORAGE.iter_subscribed_users()
    if not pairs:
        return

    log.info("Плановая проверка: %s подписок", len(pairs))
    for user, sub in pairs:
        try:
            notify, text, total = await check_subscription(user, sub)
            if notify and text:
                await context.bot.send_message(user.chat_id, text)
                log.info(
                    "Уведомление chat=%s sub=%s total=%s",
                    user.chat_id,
                    sub.id,
                    total,
                )
        except Exception as exc:  # noqa: BLE001
            log.error("Ошибка chat=%s sub=%s: %s", user.chat_id, sub.id, exc)


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("Задайте TELEGRAM_BOT_TOKEN в .env (создайте бота у @BotFather)")

    app = (
        Application.builder()
        .token(token)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("polis", polis_cmd))
    app.add_handler(CommandHandler("departments", departments_cmd))
    app.add_handler(CommandHandler("list", list_cmd))
    app.add_handler(CommandHandler("unfollow", unfollow_cmd))
    app.add_handler(CommandHandler("check", check_cmd))
    app.add_handler(CommandHandler("me", me_cmd))
    app.add_handler(CommandHandler("delete", delete_cmd))

    app.add_handler(CallbackQueryHandler(on_department, pattern=r"^d:"))
    app.add_handler(CallbackQueryHandler(on_hospital, pattern=r"^h:"))
    app.add_handler(CallbackQueryHandler(on_follow, pattern=r"^f:"))

    app.job_queue.run_repeating(
        monitor_job,
        interval=CHECK_INTERVAL_SEC,
        first=10,
        name="monitor",
    )

    log.info(
        "Бот запущен. Интервал проверки: %s сек. Данные: %s",
        CHECK_INTERVAL_SEC,
        DATA_DIR,
    )
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
