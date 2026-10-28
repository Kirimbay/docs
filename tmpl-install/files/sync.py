#!/usr/bin/python3
# tmpl user sync: Hiddify DB -> /etc/tmpl/xray.json + /etc/tmpl/hy2.json ; restart only on change
import json,subprocess,os,datetime,sys
P=json.load(open('/etc/tmpl/params.json')); D=P['domain']
CRT=f'/etc/tmpl/{D}.crt'; KEY=f'/etc/tmpl/{D}.key'
q="select uuid,enable,usage_limit,current_usage,start_date,package_days from user"
rows=subprocess.run(['mysql','-N','-B','hiddifypanel','-e',q],capture_output=True,text=True,check=True).stdout.strip().splitlines()
today=datetime.date.today(); users=[]
for l in rows:
    u,en,lim,cur,sd,pd=l.split('\t')
    if en!='1': continue
    if int(lim)>0 and int(cur)>=int(lim): continue
    if sd not in ('NULL','') and datetime.date.fromisoformat(sd)+datetime.timedelta(days=int(pd))<today: continue
    users.append(u)
# extra template-only test uuids (not in Hiddify DB)
try: users+= [x.strip() for x in open('/etc/tmpl/extra-uuids') if x.strip() and not x.startswith('#')]
except FileNotFoundError: pass
if os.environ.get('TMPL_ONLY'): users=os.environ['TMPL_ONLY'].split(',')
users=sorted(set(users))
tls=lambda alpn:{"serverName":D,"alpn":alpn,"minVersion":"1.2","certificates":[{"certificateFile":CRT,"keyFile":KEY}]}
sn={"enabled":True,"destOverride":["http","tls","quic"]}
ACC="/dev/shm/xray_access.log" if P.get("access_log",True) else "none"
X={"log":{"loglevel":"warning","access":ACC,"dnsLog":False},"api":{"tag":"api","services":["StatsService","HandlerService"]},"stats":{},
"policy":{"levels":{"0":{"statsUserUplink":True,"statsUserDownlink":True}},"system":{"statsInboundUplink":True,"statsInboundDownlink":True}},
"inbounds":[
 {"tag":"api","listen":"127.0.0.1","port":10885,"protocol":"dokodemo-door","settings":{"address":"127.0.0.1"}},
 {"tag":"sova","listen":"0.0.0.0","port":__SOVA__,"protocol":"vless","settings":{"clients":[{"id":u,"email":u+"@tmpl"} for u in users],"decryption":"none"},
  "streamSettings":{"network":"grpc","grpcSettings":{"serviceName":P['grpc_service']},"security":"tls","tlsSettings":tls(["h2"])},"sniffing":sn},
 {"tag":"tigr","listen":"0.0.0.0","port":__TIGR__,"protocol":"vless","settings":{"clients":[{"id":u,"email":u+"@tmpl","flow":"xtls-rprx-vision"} for u in users],"decryption":"none"},
  "streamSettings":{"network":"tcp","security":"reality","realitySettings":{"dest":"127.0.0.1:__SOVA__","serverNames":[D],"privateKey":P['reality_priv'],"shortIds":[P['short_id']]}},"sniffing":sn},
 {"tag":"trojan","listen":"0.0.0.0","port":__KRAB__,"protocol":"trojan","settings":{"clients":[{"password":u,"email":u+"@tmpl"} for u in users]},
  "streamSettings":{"network":"httpupgrade","httpupgradeSettings":{"path":P['trojan_path'],"host":D},"security":"tls","tlsSettings":tls(["http/1.1"])},"sniffing":sn},
 {"tag":"vmess","listen":"0.0.0.0","port":__UTKA__,"protocol":"vmess","settings":{"clients":[{"id":u,"email":u+"@tmpl"} for u in users]},
  "streamSettings":{"network":"ws","wsSettings":{"path":P['vmess_path'],"host":D},"security":"tls","tlsSettings":tls(["http/1.1"])},"sniffing":sn}],
"outbounds":[{"tag":"direct","protocol":"freedom"},{"tag":"block","protocol":"blackhole"},{"tag":"bittorrent","protocol":"blackhole"}],
"routing":{"rules":[{"inboundTag":["api"],"outboundTag":"api"},{"ip":["geoip:private"],"outboundTag":"block"},{"protocol":["bittorrent"],"outboundTag":"bittorrent"}]}}
H={"log":{"level":"warn"},"inbounds":[{"type":"hysteria2","tag":"ryba","listen":"::","listen_port":__RYBA__,
 "users":[{"name":u,"password":u} for u in users],"ignore_client_bandwidth":True,
 "tls":{"enabled":True,"server_name":D,"alpn":["h3"],"certificate_path":CRT,"key_path":KEY}}],"outbounds":[{"type":"direct","tag":"direct"}],"route":{"rules":[{"action":"sniff"},{"protocol":["bittorrent"],"action":"reject"},{"ip_is_private":True,"action":"reject"}]}}
# --animals: drop inbounds of disabled animals (Тигр needs Сова as Reality dest -> Сова then listens on 127.0.0.1 only)
AN=P.get('animals') or ['sova','tigr','utka','ryba']
TAGS={'sova':'sova','tigr':'tigr','krab':'trojan','utka':'vmess'}
for k,t in TAGS.items():
    if k in AN: continue
    if k=='sova' and 'tigr' in AN:
        next(ib for ib in X['inbounds'] if ib['tag']=='sova')['listen']='127.0.0.1'
    else: X['inbounds']=[ib for ib in X['inbounds'] if ib['tag']!=t]
XB='/etc/tmpl/bin/tmpl-xray'; API='--server=127.0.0.1:10885'
def xusers(c):
    return {ib['tag']:{(x.get('email')) for x in ib['settings'].get('clients',[])} for ib in c['inbounds'] if ib['tag']!='api'}
def live_update(old,new):
    """apply user diff to running tmpl-xray via API; True if ok (no restart needed)"""
    import tempfile
    if subprocess.run(['systemctl','is-active','-q','tmpl-xray']).returncode: return False
    o,n=xusers(old),xusers(new)
    if set(o)!=set(n): return False
    for ib in new['inbounds']:
        t=ib['tag']
        if t=='api': continue
        rm=sorted(o[t]-n[t]); add=sorted(n[t]-o[t])
        if rm and subprocess.run([XB,'api','rmu',API,f'-tag={t}']+rm,capture_output=True).returncode: return False
        if add:
            cl=[x for x in ib['settings']['clients'] if x.get('email') in add]
            f=tempfile.NamedTemporaryFile('w',suffix='.json',delete=False)
            json.dump({"inbounds":[{**ib,"settings":{**ib['settings'],"clients":cl}}]},f); f.close()
            r=subprocess.run([XB,'api','adu',API,f.name],capture_output=True); os.unlink(f.name)
            if r.returncode: return False
    return True
def strip_users(c):
    c=json.loads(json.dumps(c))
    for ib in c['inbounds']:
        for k in ('clients','users'):
            if k in ib.get('settings',{}): ib['settings'][k]=[]
        if 'users' in ib: ib['users']=[]
    return c
if P.get("hy2_stats"): H["experimental"]={"v2ray_api":{"listen":"127.0.0.1:10886","stats":{"enabled":True,"users":users}}}
ch=[]; api=[]
for f,c,svc in (('/etc/tmpl/xray.json',X,'tmpl-xray'),)+((('/etc/tmpl/hy2.json',H,'tmpl-hy2'),) if 'ryba' in AN else ()):
    s=json.dumps(c,indent=1,ensure_ascii=False)
    old=open(f).read() if os.path.exists(f) else ''
    if s!=old:
        oc=json.loads(old) if old else None
        open(f+'.new','w').write(s); os.chmod(f+'.new',0o600); os.replace(f+'.new',f)
        # only users changed on xray -> live API update, no restart (no dropped connections)
        if svc=='tmpl-xray' and oc and strip_users(oc)==strip_users(c) and live_update(oc,c): api.append(svc)
        else: ch.append(svc)
for svc in ch: subprocess.run(['systemctl','restart',svc])
open('/etc/tmpl/users.count.new','w').write(str(len(users))); os.replace('/etc/tmpl/users.count.new','/etc/tmpl/users.count')
print(f"users={len(users)} restarted={ch} api_updated={api}")
