#!/usr/bin/python3
# tmpl-sub: wraps Hiddify subscription, appends template configs. Listens 127.0.0.1:2099 (haproxy routes sub paths here).
import json,base64,ssl,socket,http.client,re,urllib.parse
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
P=json.load(open('/etc/tmpl/params.json')); D=P['domain']
UUID=re.compile(r"/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/",re.I)
def links(u):
    q=urllib.parse.quote
    vm={"v":"2","ps":"🦆 Утка","add":D,"port":"__UTKA__","id":u,"aid":"0","scy":"auto","net":"ws","type":"none","host":D,"path":P['vmess_path'],"tls":"tls","sni":D,"alpn":"http/1.1","fp":"chrome"}
    return sel([
     f"vless://{u}@{D}:__SOVA__?type=grpc&serviceName={P['grpc_service']}&mode=gun&security=tls&sni={D}&fp=chrome&alpn=h2&encryption=none#"+q("🦉 Сова"),
     f"vless://{u}@{D}:__TIGR__?type=tcp&security=reality&sni={D}&fp=firefox&pbk={P['reality_pub']}&sid={P['short_id']}&flow=xtls-rprx-vision&encryption=none#"+q("🐅 Тигр"),
     f"trojan://{u}@{D}:__KRAB__?security=tls&type=httpupgrade&host={D}&path={q(P['trojan_path'],safe='')}&sni={D}&fp=chrome&alpn=http%2F1.1#"+q("🦀 Краб"),
     "vmess://"+base64.b64encode(json.dumps(vm,ensure_ascii=False).encode()).decode(),
     f"hy2://{u}@{D}:__RYBA__?sni={D}&alpn=h3#"+q("🐟 Рыба")])
FILTER_HIDDIFY=bool(P.get("filter_hiddify",False))  # params.json "filter_hiddify"; installer sets true with --disable-old yes
def is_hiddify(l):
    l=l.strip(); m=re.match(r'^(\w+)://[^@]*@([^:/?#]+):(\d+)',l)
    if not m: return False
    sch,host,port=m.group(1).lower(),m.group(2),m.group(3)
    if sch in ('hysteria2','hy2') and not (port=='__RYBA__' and host==D): return True
    if sch=='vless' and 'security=reality' in l and not (port=='__TIGR__' and host==D): return True
    return False
def flt(t):
    if not FILTER_HIDDIFY: return t
    return '\n'.join(x for x in t.split('\n') if not is_hiddify(x))
ALL_ANIMALS=['🦉 Сова','🐅 Тигр','🦀 Краб','🦆 Утка','🐟 Рыба']; KEYS=['sova','tigr','krab','utka','ryba']; DEF=['sova','tigr','utka','ryba']  # default set (Краб optional)
EN=[i for i,k in enumerate(KEYS) if k in (P.get('animals') or DEF)]   # --animals selection
ANIMALS=[ALL_ANIMALS[i] for i in EN]
sel=lambda l:[l[i] for i in EN]
JSON_UA=('hiddify','sing-box','singbox','sfi','sfa','sfm','sft','karing')
def sb_outbounds(u):
    t=lambda fp,alpn:{"enabled":True,"server_name":D,"utls":{"enabled":True,"fingerprint":fp},**({"alpn":alpn} if alpn else {})}
    return sel([
     {"type":"vless","tag":ALL_ANIMALS[0],"server":D,"server_port":__SOVA__,"uuid":u,"transport":{"type":"grpc","service_name":P['grpc_service']},"tls":t("chrome",["h2"])},
     {"type":"vless","tag":ALL_ANIMALS[1],"server":D,"server_port":__TIGR__,"uuid":u,"flow":"xtls-rprx-vision","tls":{**t("firefox",None),"reality":{"enabled":True,"public_key":P['reality_pub'],"short_id":P['short_id']}}},
     {"type":"trojan","tag":ALL_ANIMALS[2],"server":D,"server_port":__KRAB__,"password":u,"transport":{"type":"httpupgrade","host":D,"path":P['trojan_path']},"tls":t("chrome",["http/1.1"])},
     {"type":"vmess","tag":ALL_ANIMALS[3],"server":D,"server_port":__UTKA__,"uuid":u,"security":"auto","alter_id":0,"transport":{"type":"ws","path":P['vmess_path'],"headers":{"Host":D}},"tls":t("chrome",["http/1.1"])},
     {"type":"hysteria2","tag":ALL_ANIMALS[4],"server":D,"server_port":__RYBA__,"password":u,"tls":{"enabled":True,"server_name":D,"alpn":["h3"]}}])
PROXY_T=('vless','vmess','trojan','hysteria2','hysteria','shadowsocks','tuic','shadowtls','wireguard','ssh','socks','http','anytls')
def inject_json(j,u):
    obs=j.setdefault('outbounds',[])
    drop=set()
    if FILTER_HIDDIFY:
        for o in obs:
            tl=o.get('tls') or {}
            if (o.get('type')=='hysteria2' and not (o.get('server')==D and o.get('server_port')==__RYBA__)) or \
               (o.get('type')=='vless' and (tl.get('reality') or {}).get('enabled') and not (o.get('server')==D and o.get('server_port')==__TIGR__)):
                drop.add(o.get('tag'))
    obs[:]=[o for o in obs if o.get('tag') not in drop and o.get('tag') not in ALL_ANIMALS]
    groups=[o for o in obs if o.get('type') in ('selector','urltest')]
    if not any(g.get('type')=='urltest' for g in groups):
        g={"type":"urltest","tag":"Auto","outbounds":[],"url":"https://www.gstatic.com/generate_204","interval":"10m","tolerance":50}
        obs.insert(0,g); groups.append(g)
    if not any(g.get('type')=='selector' for g in groups):
        g={"type":"selector","tag":"Select","outbounds":[x['tag'] for x in groups if x['type']=='urltest'],"default":"Auto"}
        obs.insert(0,g); groups.append(g)
    gt={g['tag'] for g in groups}
    for g in groups:
        g['outbounds']=[x for x in g.get('outbounds',[]) if x not in drop and x not in ALL_ANIMALS]+ANIMALS
        if g.get('default') and g['default'] not in g['outbounds']:
            g['default']=next((x for x in g['outbounds'] if x in gt),(ANIMALS or ['direct'])[0])
    i=next((k for k,o in enumerate(obs) if o.get('type') not in ('selector','urltest') and o.get('type') not in PROXY_T),len(obs))
    obs[i:i]=sb_outbounds(u)
    alltags={o.get('tag') for o in obs}|{e.get('tag') for e in j.get('endpoints') or []}
    r=j.get('route') or {}
    if r.get('final') and r['final'] not in alltags: r['final']=next(g['tag'] for g in obs if g.get('type')=='selector')
    for rule in r.get('rules') or []:
        if rule.get('outbound') in drop: rule['outbound']=r.get('final') or 'Select'
    for sv in (j.get('dns') or {}).get('servers') or []:
        if sv.get('detour') in drop: sv.pop('detour')
    return j
def xr_outbounds(u):
    """xray-core outbounds for the enabled animals (v2rayNG/v2rayN 'custom config' JSON array subscriptions)"""
    tls=lambda alpn:{"serverName":D,"fingerprint":"chrome","alpn":alpn}
    return sel([
     {"protocol":"vless","settings":{"vnext":[{"address":D,"port":__SOVA__,"users":[{"id":u,"encryption":"none"}]}]},
      "streamSettings":{"network":"grpc","grpcSettings":{"serviceName":P['grpc_service']},"security":"tls","tlsSettings":tls(["h2"])}},
     {"protocol":"vless","settings":{"vnext":[{"address":D,"port":__TIGR__,"users":[{"id":u,"encryption":"none","flow":"xtls-rprx-vision"}]}]},
      "streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":D,"fingerprint":"firefox","publicKey":P['reality_pub'],"shortId":P['short_id']}}},
     {"protocol":"trojan","settings":{"servers":[{"address":D,"port":__KRAB__,"password":u}]},
      "streamSettings":{"network":"httpupgrade","httpupgradeSettings":{"path":P['trojan_path'],"host":D},"security":"tls","tlsSettings":tls(["http/1.1"])}},
     {"protocol":"vmess","settings":{"vnext":[{"address":D,"port":__UTKA__,"users":[{"id":u,"security":"auto","alterId":0}]}]},
      "streamSettings":{"network":"ws","wsSettings":{"path":P['vmess_path'],"host":D},"security":"tls","tlsSettings":tls(["http/1.1"])}},
     {"protocol":"hysteria","settings":{"version":2,"address":D,"port":__RYBA__},
      "streamSettings":{"network":"hysteria","hysteriaSettings":{"version":2,"auth":u},"security":"tls","tlsSettings":{"serverName":D,"alpn":["h3"]}}}])
def inject_xray_list(j,u):
    base=next((e for e in j if isinstance(e,dict) and isinstance(e.get('outbounds'),list)),None)
    if base is None: return None
    def ours(e):
        return e.get('remarks') in ALL_ANIMALS
    def hid(e):
        o=(e.get('outbounds') or [{}])[0]; ss=o.get('streamSettings') or {}
        return o.get('protocol')=='hysteria' or ss.get('security')=='reality'
    out=[e for e in j if not ours(e) and not (FILTER_HIDDIFY and hid(e))]
    for name,ob in zip(ANIMALS,xr_outbounds(u)):
        e=json.loads(json.dumps(base)); e['remarks']=name
        rest=[o for o in e['outbounds'][1:] if o.get('tag')!='fragment']
        e['outbounds']=[{"tag":"proxy",**ob}]+rest
        out.append(e)
    return out
_ACT={'m':0,'s':''}
def active(u):
    """uuid present in tmpl-xray config; cached, keeps last good copy if the file is unreadable mid-restart"""
    import os
    try:
        m=os.stat('/etc/tmpl/xray.json').st_mtime
        if m!=_ACT['m']:
            t=open('/etc/tmpl/xray.json').read()
            if t.strip(): _ACT['s']=t; _ACT['m']=m
    except Exception: pass
    return u in _ACT['s']
def extra(u):
    try: return u in open('/etc/tmpl/extra-uuids').read()
    except Exception: return False
# every sub path form Hiddify 12 accepts: /<client|legacy proxy_path|admin>/[<child_id>/]<uuid>[/<endpoint>]
ALTP=[x for x in (P.get('legacy_path'),) if x and x!=P['client_path']]  # admin_path NOT here — panel login
SUBRE=re.compile(r'^/([^/]+)/(?:(\d+)/)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(/[^?]*)?(\?.*)?$')
def upstream_path(p):
    """normalise to the client path Hiddify serves without login: legacy/admin path -> client path, lowercase uuid,
    missing trailing slash added (Hiddify would 308-redirect to http://)"""
    m=SUBRE.match(p)
    if not m: return p,None
    pp,child,u,rest,q=m.groups(); u=u.lower()
    if pp in ALTP: pp=P['client_path']
    return f"/{pp}/{child+'/' if child else ''}{u}{rest or '/'}{q or ''}",u
def fetch(host,path,hd):
    ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    err=None
    for attempt in range(2):
        try:
            p=path
            for hop in range(4):  # follow same-host redirects internally (old clients often don't)
                s=ctx.wrap_socket(socket.create_connection(('127.0.0.1',443),timeout=4),server_hostname=host)
                c=http.client.HTTPConnection(host); c.sock=s
                c.request('GET',p,headers=hd); r=c.getresponse(); body=r.read(); st=r.status; rh=r.getheaders(); c.close()
                loc=r.getheader('Location') or ''
                if st in (301,302,307,308) and loc:
                    u=urllib.parse.urlsplit(loc)
                    if (not u.netloc or u.hostname==host) and 'force=1' not in loc and '/admin' not in u.path:
                        p=u.path+('?'+u.query if u.query else ''); continue
                break
            if st>=500 and attempt<2: import time; time.sleep(0.2); continue
            return st,rh,body
        except Exception as e:
            err=e; import time; time.sleep(0.2)
    return 502,[],b''
CLIENT_UA=('happ','v2ray','hiddify','sing-box','singbox','sfi','sfa','sfm','sft','streisand','shadowrocket','nekobox','nekoray','karing','foxray','v2box','throne','incy','husi','exclave','oneclick','clash','mihomo','stash')
def inject(st,rh,body,u,ua,pth):
    add='\n'.join(links(u))
    t=body.decode() if st==200 else ''; ts=t.strip()
    isjson=ts.startswith('{') or ((st!=200 or not ts) and any(k in ua for k in JSON_UA))
    if not ts and pth.endswith('/xray'):  # Hiddify had nothing (old protocols off) -> xray JSON array of animals only
        base=[{"remarks":"base","log":{"loglevel":"warning"},"inbounds":[{"tag":"socks","port":10808,"listen":"127.0.0.1","protocol":"socks","settings":{"udp":True}}],"outbounds":[{"tag":"direct","protocol":"freedom"}]}]
        r2=inject_xray_list(base,u)
        return 200,[('Content-Type','application/json')],json.dumps([e for e in r2 if e.get('remarks')!='base'],ensure_ascii=False,indent=1).encode()
    if isjson:
        j=json.loads(ts) if ts else {"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"Select"}}
        if isinstance(j,dict) and (not ts or isinstance(j.get('outbounds'),list)):
            body=json.dumps(inject_json(j,u),ensure_ascii=False,indent=1).encode()
            if st!=200: st=200; rh=[('Content-Type','application/json')]
    elif ts.startswith('['):  # xray JSON array (v2rayNG/v2rayN custom configs): add 5 animal configs
        r2=inject_xray_list(json.loads(ts),u)
        if r2 is not None: body=json.dumps(r2,ensure_ascii=False,indent=1).encode()
    elif ts.startswith('<') or 'proxies:' in t[:2000]: pass  # HTML/Clash: untouched
    else:
        dec=None
        if ts and '://' not in ts and '\n' not in ts:
            try: dec=base64.b64decode(ts+'='*(-len(ts)%4)).decode()
            except Exception: dec=None
        if dec is not None:
            body=base64.b64encode((flt(dec).strip('\n')+'\n'+add+'\n').lstrip('\n').encode())
        else:
            keep=flt(t).strip('\n')
            out=((keep+'\n') if keep else '')+add+'\n'
            if not ts and ('happ' in ua or pth.endswith('sub64')): body=base64.b64encode(out.encode())
            else: body=out.encode()
        if st!=200:
            st=200; rh=[('Content-Type','text/plain; charset=utf-8')]
    return st,rh,body
class H(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a): pass
    def do_HEAD(self): self.do_GET(head=True)
    def do_GET(self,head=False):
        host=(self.headers.get('Host') or D).split(':')[0]
        hd={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','accept-encoding')}
        hd['Host']=host; hd['X-Tmpl-Orig']='1'; hd['Accept-Encoding']='identity'
        fp,u=upstream_path(self.path)
        st,rh,body=fetch(host,fp,hd)
        ua=(self.headers.get('User-Agent') or '').lower(); pth=fp.split('?')[0].rstrip('/')
        if u and active(u) and (st==200 or (st in (301,302,307,308,404,500,502,503) and (extra(u) or any(k in ua for k in CLIENT_UA) or re.search(r'/(xray|sub|sub64|auto|singbox|all\.txt)/?$',pth+'/')))):
            try:
                st2,rh2,b2=inject(st,rh,body,u,ua,pth)
                if b2 and b2.strip(): st,rh,body=st2,rh2,b2   # never replace a response with an empty one
            except Exception: pass   # any error -> Hiddify's original response
        self.send_response(st)
        for k,v in rh:
            if k.lower() not in ('content-length','transfer-encoding','connection','content-encoding','date','server'): self.send_header(k,v)
        self.send_header('Content-Length',str(len(body))); self.end_headers()
        if not head: self.wfile.write(body)
class S(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=128
S(('127.0.0.1',2099),H).serve_forever()
