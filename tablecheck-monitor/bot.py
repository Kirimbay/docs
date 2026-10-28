#!/usr/bin/env python3
"""Interactive Telegram bot for Uno Mas TableCheck monitoring.

Buttons:
  ▶ Старт мониторинг
  ⏹ Стоп мониторинг
  🔍 Проверить сейчас
  ℹ️ Статус
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from telegram import KeyboardButton, ReplyKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from storage import (
    ROOT,
    is_monitoring_enabled,
    load_chat_id,
    load_state,
    persist_chat_id,
    save_state,
    set_monitoring_enabled,
)
from tablecheck_client import AvailableSlot, TableCheckClient, booking_days

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("uno-mas-bot")

BTN_START = "▶ Старт мониторинг"
BTN_STOP = "⏹ Стоп мониторинг"
BTN_CHECK = "🔍 Проверить сейчас"
BTN_STATUS = "ℹ️ Статус"

KEYBOARD = ReplyKeyboardMarkup(
    [
        [KeyboardButton(BTN_START), KeyboardButton(BTN_STOP)],
        [KeyboardButton(BTN_CHECK), KeyboardButton(BTN_STATUS)],
    ],
    resize_keyboard=True,
)


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else default


def load_config() -> dict:
    load_dotenv(ROOT / ".env")
    shop = os.getenv("SHOP_SLUG", "centara-mirage-beach-resort-dubai-uno-mas").strip()
    return {
        "shop_slug": shop,
        "booking_url": os.getenv(
            "BOOKING_URL",
            f"https://www.tablecheck.com/en/shops/{shop}/reserve",
        ).strip(),
        "adults": env_int("NUM_ADULTS", 4),
        "children": env_int("NUM_CHILDREN", 2),
        "seniors": env_int("NUM_SENIORS", 0),
        "babies": env_int("NUM_BABIES", 0),
        "days": env_int("DAYS", 2),
        "interval": env_int("CHECK_INTERVAL_SEC", 900),
        "meal_filter": os.getenv("MEAL_FILTER", "all").strip() or "all",
        "timezone": os.getenv("TIMEZONE", "Asia/Dubai").strip() or "Asia/Dubai",
        "min_hours_before": env_float("MIN_HOURS_BEFORE", 5.0),
        "telegram_token": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
    }


def party_label(cfg: dict) -> str:
    parts = [f"{cfg['adults']} взр."]
    if cfg["children"]:
        parts.append(f"{cfg['children']} дет.")
    if cfg["seniors"]:
        parts.append(f"{cfg['seniors']} sen.")
    if cfg["babies"]:
        parts.append(f"{cfg['babies']} baby")
    return ", ".join(parts)


def slot_key(item: AvailableSlot) -> str:
    return f"{item.slot.day.isoformat()}|{item.slot.epoch}|{item.slot.label}"


def format_slots(items: list[AvailableSlot], tz: ZoneInfo) -> str:
    lines = []
    for item in items:
        local = item.slot.dubai_dt(tz)
        lines.append(f"• {local.strftime('%a %Y-%m-%d %H:%M')} ({item.slot.label})")
    return "\n".join(lines)


def find_slots(cfg: dict) -> list[AvailableSlot]:
    tz = ZoneInfo(cfg["timezone"])
    client = TableCheckClient(cfg["shop_slug"])
    client.warm_up()
    days = booking_days(cfg["days"], tz)
    return client.find_available(
        days,
        adults=cfg["adults"],
        children=cfg["children"],
        seniors=cfg["seniors"],
        babies=cfg["babies"],
        tz=tz,
        min_hours_before=cfg["min_hours_before"],
        meal_filter=cfg["meal_filter"],
    )


def remember_slots(found: list[AvailableSlot], *, notify_keys: list[str] | None = None) -> dict:
    """Update last_check / last_available; optionally mark keys as already notified."""
    tz_now = datetime.now().isoformat(timespec="seconds")
    state = load_state()
    state["last_check"] = tz_now
    state["last_available"] = [slot_key(i) for i in found]
    if notify_keys is not None:
        notified = state.setdefault("notified", {})
        for key in notify_keys:
            notified[key] = tz_now
    # prune old notified
    cutoff_epoch = datetime.now().timestamp() - 3 * 24 * 3600
    notified = state.setdefault("notified", {})
    for key in list(notified):
        try:
            epoch = int(key.split("|")[1])
        except (IndexError, ValueError):
            del notified[key]
            continue
        if epoch < cutoff_epoch:
            del notified[key]
    save_state(state)
    return state


def new_slots(found: list[AvailableSlot]) -> list[AvailableSlot]:
    state = load_state()
    notified = state.get("notified") or {}
    return [item for item in found if slot_key(item) not in notified]


def status_text(cfg: dict) -> str:
    state = load_state()
    enabled = bool(state.get("monitoring_enabled"))
    interval_min = max(60, cfg["interval"]) // 60
    lines = [
        "Uno Mas — статус",
        f"Мониторинг: {'включён ▶' if enabled else 'выключен ⏹'}",
        f"Состав: {party_label(cfg)}",
        f"Интервал: каждые {interval_min} мин",
        f"Фильтр: {cfg['meal_filter']}",
        f"Последняя проверка: {state.get('last_check') or '—'}",
        f"Слотов в последней проверке: {len(state.get('last_available') or [])}",
        "",
        f"Бронь: {cfg['booking_url']}",
    ]
    return "\n".join(lines)


async def reply(update: Update, text: str) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(text, reply_markup=KEYBOARD)


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat:
        persist_chat_id(update.effective_chat.id)
    cfg = context.application.bot_data["cfg"]
    await reply(
        update,
        "Uno Mas monitor готов.\n\n"
        f"Состав: {party_label(cfg)}\n"
        "▶ Старт — проверять свободные столики каждые 15 мин\n"
        "⏹ Стоп — ничего не проверять и не писать\n"
        "🔍 Проверить сейчас — один раз без включения мониторинга\n\n"
        + status_text(cfg),
    )


async def on_start_monitoring(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat:
        persist_chat_id(update.effective_chat.id)
    cfg = context.application.bot_data["cfg"]
    set_monitoring_enabled(True)
    await reply(
        update,
        "Мониторинг включён ▶\n"
        f"Буду проверять каждые {max(60, cfg['interval']) // 60} мин "
        f"({party_label(cfg)}).",
    )
    # Immediate check so the user gets current openings right away
    await do_check_and_notify(context, chat_id=update.effective_chat.id, force_report=True)


async def on_stop_monitoring(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat:
        persist_chat_id(update.effective_chat.id)
    set_monitoring_enabled(False)
    await reply(
        update,
        "Мониторинг выключен ⏹\n"
        "Больше не проверяю TableCheck и не присылаю слоты.\n"
        "Когда снова понадобится — нажми «▶ Старт мониторинг».",
    )


async def on_check_now(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat:
        persist_chat_id(update.effective_chat.id)
    await reply(update, "Проверяю TableCheck…")
    await do_check_and_notify(
        context,
        chat_id=update.effective_chat.id,
        force_report=True,
        only_if_monitoring=False,
    )


async def on_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat:
        persist_chat_id(update.effective_chat.id)
    cfg = context.application.bot_data["cfg"]
    await reply(update, status_text(cfg))


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (update.effective_message.text or "").strip()
    if text == BTN_START:
        await on_start_monitoring(update, context)
    elif text == BTN_STOP:
        await on_stop_monitoring(update, context)
    elif text == BTN_CHECK:
        await on_check_now(update, context)
    elif text == BTN_STATUS:
        await on_status(update, context)
    else:
        await cmd_start(update, context)


async def do_check_and_notify(
    context: ContextTypes.DEFAULT_TYPE,
    *,
    chat_id: int | str | None = None,
    force_report: bool = False,
    only_if_monitoring: bool = True,
) -> None:
    cfg = context.application.bot_data["cfg"]
    if only_if_monitoring and not is_monitoring_enabled():
        log.info("Skip check: monitoring disabled")
        return

    target = chat_id or load_chat_id()
    if not target:
        log.warning("No chat_id — skip notify")
        return

    tz = ZoneInfo(cfg["timezone"])
    try:
        found = find_slots(cfg)
    except Exception as exc:  # noqa: BLE001
        log.exception("Availability check failed: %s", exc)
        if force_report:
            await context.bot.send_message(
                chat_id=target,
                text=f"Ошибка проверки TableCheck: {exc}",
                reply_markup=KEYBOARD,
            )
        return

    log.info("Found %s available slot(s)", len(found))
    fresh = new_slots(found)

    if force_report:
        if found:
            text = (
                "Uno Mas — сейчас свободно:\n"
                f"Состав: {party_label(cfg)}\n"
                f"{format_slots(found, tz)}\n\n"
                f"Бронировать: {cfg['booking_url']}"
            )
        else:
            text = (
                "Uno Mas — сейчас свободных слотов нет "
                f"({party_label(cfg)}, окно ~24ч)."
            )
        await context.bot.send_message(chat_id=target, text=text, reply_markup=KEYBOARD)
        remember_slots(found, notify_keys=[slot_key(i) for i in found])
        return

    if fresh:
        text = (
            "Uno Mas — появились свободные столики!\n"
            f"Состав: {party_label(cfg)}\n"
            f"{format_slots(fresh, tz)}\n\n"
            f"Бронировать: {cfg['booking_url']}\n"
            "Окно бронирования обычно ~24 часа до визита."
        )
        await context.bot.send_message(chat_id=target, text=text, reply_markup=KEYBOARD)
        remember_slots(found, notify_keys=[slot_key(i) for i in fresh])
    else:
        remember_slots(found)


async def scheduled_check(context: ContextTypes.DEFAULT_TYPE) -> None:
    await do_check_and_notify(context, only_if_monitoring=True, force_report=False)


async def on_post_init(app: Application) -> None:
    cfg = app.bot_data["cfg"]
    chat_id = load_chat_id()
    # Ensure monitoring starts OFF after deploy/restart unless already explicitly enabled
    state = load_state()
    if state.get("monitoring_enabled") is not False and state.get("monitoring_enabled") is not True:
        set_monitoring_enabled(False)
    if chat_id:
        enabled = is_monitoring_enabled()
        text = (
            "Uno Mas bot обновлён: теперь есть кнопки Старт/Стоп.\n\n"
            + status_text(cfg)
            + (
                "\n\nСейчас мониторинг выключен — спама не будет. "
                "Когда снова понадобится слежение, нажми «▶ Старт мониторинг»."
                if not enabled
                else "\n\nМониторинг сейчас включён."
            )
        )
        try:
            await app.bot.send_message(chat_id=chat_id, text=text, reply_markup=KEYBOARD)
        except Exception as exc:  # noqa: BLE001
            log.warning("Startup notify failed: %s", exc)


def main() -> None:
    cfg = load_config()
    token = cfg["telegram_token"]
    if not token:
        raise SystemExit("TELEGRAM_BOT_TOKEN is empty")

    # Default: monitoring OFF until user presses Start (avoids spam after booking)
    state = load_state()
    if "monitoring_enabled" not in state:
        set_monitoring_enabled(False)

    app = (
        Application.builder()
        .token(token)
        .post_init(on_post_init)
        .build()
    )
    app.bot_data["cfg"] = cfg

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_start))
    app.add_handler(CommandHandler("status", on_status))
    app.add_handler(CommandHandler("check", on_check_now))
    app.add_handler(CommandHandler("watch", on_start_monitoring))
    app.add_handler(CommandHandler("stop", on_stop_monitoring))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    interval = max(60, cfg["interval"])
    if app.job_queue is None:
        raise SystemExit(
            "JobQueue unavailable — install python-telegram-bot[job-queue]"
        )
    app.job_queue.run_repeating(scheduled_check, interval=interval, first=20)

    log.info(
        "Bot starting; monitoring_enabled=%s interval=%ss",
        is_monitoring_enabled(),
        interval,
    )
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
