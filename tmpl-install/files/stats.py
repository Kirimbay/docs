#!/usr/bin/python3
# tmpl-stats (timer 60s): template traffic -> Hiddify usage.
#  1. read+reset per-user counters: tmpl-xray (127.0.0.1:10885) and tmpl-hy2 sing-box v2ray_api (127.0.0.1:10886, if built with it)
#  2. add to spool /var/lib/tmpl-stats/pending.json FIRST (fsync) -> nothing lost if DB is busy/down
#  3. CALL add_usage_json(json, now)  = Hiddify's own procedure (atomic current_usage += x, last_online, start_date)
#     + daily_usage += x for the user's admin (today, child 0), then clear the spool. Retries next minute on any failure.
import json,os,sys,fcntl,subprocess,datetime,re,time
sys.path.insert(0,'/etc/tmpl'); import v2stats
SP='/var/lib/tmpl-stats'; PEND=SP+'/pending.json'; LOG='/var/log/tmpl-stats.log'
UU=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
os.makedirs(SP,exist_ok=True)
lk=open(SP+'/lock','w')
try: fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
except OSError: sys.exit(0)  # previous run still busy
def log(m): open(LOG,'a').write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {m}\n")
def load():
    try: return {k:int(v) for k,v in json.load(open(PEND)).items()}
    except Exception: return {}
def save(d):
    with open(PEND+'.new','w') as f: json.dump(d,f); f.flush(); os.fsync(f.fileno())
    os.replace(PEND+'.new',PEND)
pend=load(); got={}
for addr,svc,unit in (('127.0.0.1:10885',v2stats.XRAY,'tmpl-xray'),('127.0.0.1:10886',v2stats.SINGBOX,'tmpl-hy2')):
    try: st=v2stats.query(addr,svc,'user>>>',reset=True)
    except Exception as e:
        if unit=='tmpl-xray': log(f"WARN {unit} stats: {e}")
        continue
    for n,v in st.items():
        p=n.split('>>>')
        if len(p)<4 or not v: continue
        u=p[1].split('@')[0].lower()
        if UU.match(u): got[u]=got.get(u,0)+int(v)
for u,v in got.items(): pend[u]=pend.get(u,0)+v
if got: save(pend)
if not pend and not os.path.exists(SP+'/pending-daily.json'): sys.exit(0)
# only users that exist in Hiddify (template-only test users are dropped)
def my(q):
    r=subprocess.run(['mysql','-N','-B','--connect-timeout=5','hiddifypanel','-e','SET SESSION innodb_lock_wait_timeout=10; '+q],capture_output=True,text=True,timeout=60)
    if r.returncode: raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout
DAILY=SP+'/pending-daily.json'
try:
    # phase 1: users (Hiddify procedure, commits per row)
    if pend:
        ids=','.join("'"+u+"'" for u in pend)
        rows=[l.split('\t') for l in my(f"select uuid,coalesce(added_by,1) from user where uuid in ({ids})").splitlines() if l]
        known={u:a for u,a in rows}
        usages=[{"uuid":u,"usage":v} for u,v in pend.items() if u in known and v>0]
        now=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        daily=json.load(open(DAILY)) if os.path.exists(DAILY) else {}
        for x in usages:
            k=now[:10]+'|'+known[x['uuid']]; daily[k]=daily.get(k,0)+x['usage']
        if usages:
            if my("select count(*) from information_schema.routines where routine_schema='hiddifypanel' and routine_name='add_usage_json'").strip()=='1':
                my(f"CALL add_usage_json('{json.dumps(usages)}','{now}')")   # Hiddify's own procedure (v11-12)
            else:  # same semantics as the procedure, one atomic statement per user
                my(' '.join(f"UPDATE user SET current_usage=current_usage+{int(x['usage'])}, last_online='{now}', start_date=COALESCE(start_date,DATE('{now}')) WHERE uuid='{x['uuid']}';" for x in usages))
        # users done -> move their bytes to the daily spool before anything else can fail
        with open(DAILY+'.new','w') as f: json.dump(daily,f); f.flush(); os.fsync(f.fileno())
        os.replace(DAILY+'.new',DAILY); os.unlink(PEND)
        if usages: log(f"added users={len(usages)} bytes={sum(x['usage'] for x in usages)} skipped_unknown={len(pend)-len(usages)}")
    # phase 2: daily_usage per admin (single transaction)
    if os.path.exists(DAILY):
        daily=json.load(open(DAILY)); q=''
        for k,v in daily.items():
            d,a=k.split('|'); a=int(a); v=int(v)
            q+=(f"INSERT INTO daily_usage(date,`usage`,online,admin_id,child_id) SELECT '{d}',0,0,{a},0 FROM DUAL "
                f"WHERE NOT EXISTS (SELECT 1 FROM daily_usage WHERE date='{d}' AND admin_id={a} AND child_id=0); "
                f"UPDATE daily_usage SET `usage`=`usage`+{v} WHERE date='{d}' AND admin_id={a} AND child_id=0 ORDER BY id LIMIT 1; ")
        if q: my("START TRANSACTION; "+q+"COMMIT;")
        os.unlink(DAILY)
except Exception as e:
    log(f"WARN db busy/failed, kept in spool: {e}")
# keep RAM access log bounded if no torrent watcher truncates it
try:
    if os.path.getsize('/dev/shm/xray_access.log')>50*1024*1024: os.truncate('/dev/shm/xray_access.log',0)
except OSError: pass
