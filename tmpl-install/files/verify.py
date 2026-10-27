#!/usr/bin/python3
# tmpl verify: checks subscription output for every sub domain / path / client UA.
# usage: verify.py [--strict] [--quick] [--domains a,b]   strict = exactly the enabled animals (no Hiddify configs)
import json,sys,subprocess,base64,urllib.parse,re,os,tempfile
P=json.load(open('/etc/tmpl/params.json')); CP=P['client_path']
ALL=['🦉 Сова','🐅 Тигр','🦀 Краб','🦆 Утка','🐟 Рыба']; KEYS=['sova','tigr','krab','utka','ryba']; DEF=['sova','tigr','utka','ryba']
A=[a for a,k in zip(ALL,KEYS) if k in (P.get('animals') or DEF)]   # enabled animals only
strict='--strict' in sys.argv; quick='--quick' in sys.argv
doms=P.get('sub_domains') or []
if '--domains' in sys.argv: doms=sys.argv[sys.argv.index('--domains')+1].split(',')
def sql(q): return subprocess.run(['mysql','-N','-B','hiddifypanel','-e',q],capture_output=True,text=True).stdout.split()
test=[x.strip() for x in open('/etc/tmpl/extra-uuids') if x.strip() and not x.startswith('#')][:1]
real=sql("select uuid from user where enable=1 and (usage_limit=0 or current_usage<usage_limit) and (start_date is null or date_add(start_date, interval package_days day)>=curdate()) order by rand() limit 5")
real=[u for u in real if u in open('/etc/tmpl/xray.json').read()]
PFX=[CP]+[x for x in (P.get('legacy_path'),) if x and x!=CP]  # admin_path skipped (panel login)  # every sub path form
HAPPH=['-H','x-hwid: 7F3A9C2E-TEST','-H','x-device-os: macOS','-H','x-ver-os: 15.1','-H','x-device-model: MacBookPro18,3','-H','Accept-Language: ru']
def get(d,u,p,ua,pf=None):
    q='?x=1' if 'CFNetwork' in ua else ''
    r=subprocess.run(['curl','-sk','--max-time','25','--resolve',f'{d}:443:127.0.0.1','-A',ua]+(HAPPH if ua.startswith('Happ') else [])+[f'https://{d}/{pf or CP}/{u}/{p}{q}'],capture_output=True)
    return r.stdout.decode('utf-8','replace')
def names(t):
    t=t.strip()
    if t.startswith('['):
        try: return [e.get('remarks') for e in json.loads(t)]
        except Exception: return None
    if '://' not in t:
        try: t=base64.b64decode(t+'='*(-len(t)%4)).decode()
        except Exception: return None
    out=[]
    for l in t.splitlines():
        l=l.strip()
        if l.startswith('vmess://'):
            try: out.append(json.loads(base64.b64decode(l[8:]+'==').decode())['ps'])
            except Exception: out.append('?vmess')
        elif '://' in l: out.append(urllib.parse.unquote(l.split('#',1)[1]) if '#' in l else '?'+l[:15])
    return out
def jcheck(t):
    j=json.loads(t); o=j['outbounds']
    px=[x['tag'] for x in o if x['type'] not in ('selector','urltest','direct','block','dns')]
    gs=[x for x in o if x['type'] in ('selector','urltest')]
    sub={"outbounds":[x for x in o if x['type'] not in ('block','dns')],"route":{"final":(j.get('route') or {}).get('final')}}
    f=tempfile.NamedTemporaryFile('w',suffix='.json',delete=False); json.dump(sub,f); f.close()
    ok=subprocess.run(['/etc/tmpl/bin/tmpl-sing-box','check','-c',f.name],capture_output=True).returncode==0; os.unlink(f.name)
    gok=all(set(A)<=set(g['outbounds']) for g in gs) and gs
    return px,ok and bool(gok)
fail=0; res=[]
for u in test+real:
  for d in doms:
    for p in ([''] if quick else ['','auto/','sub/']):
      for ua in ['Happ/3.0','Happ/1.6.2/macOS CFNetwork/1568.200.51 Darwin/24.1.0','v2rayN/7.0','v2rayNG/1.9.30','']:
        n=names(get(d,u,p,ua)); ok=n is not None and set(A)<=set(n) and not (set(ALL)-set(A))&set(n) and (not strict or sorted(n)==sorted(A))
        fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} {u[:8]} {d}/{p} {ua}: {n}")
    for p in ([''] if quick else ['','auto/','singbox/']):
      for ua in ['HiddifyNext/2.0','SFI/1.12']:
        try: px,ck=jcheck(get(d,u,p,ua)); ok=ck and set(A)<=set(px) and not (set(ALL)-set(A))&set(px) and (not strict or sorted(px)==sorted(A))
        except Exception as e: px,ok=[f'not json: {e}'[:60]],False
        fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} {u[:8]} {d}/{p} {ua}: json {px}")
for u in test+real:
  for pf in PFX[1:]:
    d=doms[0]
    for ua in ['Happ/3.0','v2rayNG/1.9.30']:
        n=names(get(d,u,'',ua,pf)); ok=n is not None and set(A)<=set(n) and not (set(ALL)-set(A))&set(n) and (not strict or sorted(n)==sorted(A))
        fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} {u[:8]} {d} alt-path {ua}: {n}")
    try: px,ck=jcheck(get(d,u,'','HiddifyNext/2.0',pf)); ok=ck and set(A)<=set(px) and not (set(ALL)-set(A))&set(px)
    except Exception as e: px,ok=[f'not json: {e}'[:60]],False
    fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} {u[:8]} {d} alt-path HiddifyNext: json {px}")
# HTTP/3: Happ iOS/macOS follow Alt-Svc h3 -> the QUIC frontend must route subs to tmpl-sub too
try:
    secs=re.split(r'(?m)^(?=frontend |listen |backend |defaults|global)',open(P['hap_cfg']).read())
    http=[x.split()[1] for x in secs if x.startswith(('frontend','listen')) and re.search(r'(?m)^\s*mode http',x) and re.search(r'use_backend .*path|naive',x)]
    miss=[x.split()[1] for x in secs if x.startswith(('frontend','listen')) and x.split()[1] in http and '# BEGIN tmpl-sub' not in x]
    q=[x for x in http if 'quic' in x]
    ok=not miss; fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} haproxy tmpl-sub rule in http frontends {http} (quic: {q or 'none'}) missing={miss}")
    if subprocess.run(['curl','-V'],capture_output=True,text=True).stdout.find('HTTP3')>=0 and (test+real):
        t=subprocess.run(['curl','-sk','--http3-only','--max-time','15','--resolve',f'{doms[0]}:443:127.0.0.1','-A','Happ/3.0',f'https://{doms[0]}/{CP}/{(test+real)[0]}/'],capture_output=True).stdout.decode('utf-8','replace')
        n=names(t); ok=n is not None and set(A)<=set(n); fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} HTTP/3 curl: {n}")
    else: res.append("INFO curl without HTTP/3 - quic checked via haproxy config only")
except Exception as e: fail+=1; res.append(f"FAIL haproxy h3 check: {e}")
# Alt-Svc must not advertise h3 (Happ caches it; MTS LTE drops UDP 443 -> sub timeouts)
def altsvc(url):
    h=subprocess.run(['curl','-sk','-o','/dev/null','-D','-','--max-time','15','--resolve',f'{doms[0]}:443:127.0.0.1','-A','Happ/3.0',url],capture_output=True).stdout.decode('utf-8','replace')
    return [l.split(':',1)[1].strip() for l in h.splitlines() if l.lower().startswith('alt-svc:')]
if doms:
    for nm,url in [('/',f'https://{doms[0]}/')]+[(f'/{pf}/<uuid>/',f'https://{doms[0]}/{pf}/{(test+real)[0]}/') for pf in PFX if test+real]:
        v=altsvc(url); ok=not any(re.search(r'\bh3',x,re.I) for x in v); fail+=not ok; res.append(f"{'OK ' if ok else 'FAIL'} Alt-Svc no h3 on {nm}: {v or 'absent'}")
for k,nm in (('client_path','proxy_path_client'),('legacy_path','proxy_path (hidden legacy)')):
    if not P.get(k): res.append(f"WARN {nm} is EMPTY - old subscription links on this path will not work")
print('\n'.join(res)); print(f"VERIFY {'PASS' if not fail else 'FAIL'} ({len(res)-fail}/{len(res)})")
sys.exit(1 if fail else 0)
