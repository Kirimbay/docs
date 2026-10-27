#!/usr/bin/python3
# idempotent insert of tmpl-sub routing into Hiddify haproxy.cfg; prints CHANGED / UNCHANGED; exit 1 (no change) if unsafe.
# Works for Hiddify 10-12 (anchors 'use_backend naive' / generate_204) and generic layouts (Hiddify 14 generated/):
# in every frontend/listen section that routes by path (has a 'use_backend ... path' rule) our rule is inserted before the first one.
# Alt-Svc: Hiddify advertises h3 (Alt-Svc h3=":443"); Happ caches it and MTS LTE drops UDP 443 -> sub timeouts.
# So every Hiddify alt-svc h3 line is commented out ('# tmpl-h3 ' prefix) in the loaded cfg AND in the templates under
# /opt/hiddify-manager/haproxy/ (backups *.bak-h3, so apply_configs/panel update won't restore h3), and each http
# frontend gets 'http-response set-header alt-svc clear' inside our tmpl-sub block.
import re,json,subprocess,sys,os,shutil
def svc_cfgs():
    """-f args of the running hiddify-haproxy (files or dirs), so we edit/check exactly what haproxy loads.
    Reads the live process cmdline (ExecStart may use $CONFIG env vars, e.g. Hiddify 12), then ExecStart with env expanded."""
    sh=lambda p:subprocess.run(['systemctl','show','hiddify-haproxy','-p',p,'--value'],capture_output=True,text=True).stdout.strip()
    a=[]
    pid=sh('MainPID')
    if pid and pid!='0':
        try:
            v=open(f'/proc/{pid}/cmdline').read().split('\0'); a=[v[i+1] for i,x in enumerate(v[:-1]) if x=='-f']
        except Exception: a=[]
    if not a:
        env=dict(x.split('=',1) for x in sh('Environment').split() if '=' in x)
        e=sh('ExecStart'); e=re.sub(r'\$\{?(\w+)\}?',lambda m:env.get(m[1],m[0]),e)
        a=re.findall(r'-f\s+(\S+?)[\s;]',e+' ')
    return [x for x in a if os.path.exists(x)]
def find_cfg():
    c=[]
    for a in svc_cfgs() or ['/opt/hiddify-manager/haproxy/haproxy.cfg']:
        c+= [os.path.join(a,x) for x in sorted(os.listdir(a)) if x.endswith('.cfg')] if os.path.isdir(a) else [a]
    c=[x for x in c if os.path.isfile(x) and re.search(r'^\s*(frontend|listen)\b',open(x).read(),re.M)]
    return c[0] if c else None
if sys.argv[1:2]==['--find']: print(find_cfg() or ''); sys.exit(0)
P=json.load(open('/etc/tmpl/params.json')); cp=P['client_path']
# all sub path forms Hiddify 12 accepts: client path, legacy proxy_path, admin path; optional /<child_id>/; any-case uuid
pp='('+'|'.join(dict.fromkeys(x for x in (cp,P.get('legacy_path')) if x))+')'  # admin_path EXCLUDED: that URL is admin login, not sub
F=os.environ.get('HAPCFG') or P.get('hap_cfg') or find_cfg()
if not F: print('haproxy config not found'); sys.exit(1)
t0=open(F).read()
t=re.sub(r'[ ]*# BEGIN tmpl-sub.*?# END tmpl-sub\n','',t0,flags=re.S)
acl=f'METH_GET {{ path_reg ^/{pp}/([0-9]+/)?[0-9a-fA-F-]{{36}}(/.*)?$ }} !{{ path_sub /api/ /admin/ /static/ /asset/ }} !{{ req.hdr(x-tmpl-orig) -m found }}'
H3=re.compile(r'^([ \t]*)(?!#)(\S.*\balt-svc\b.*\bh3\b.*)$',re.M|re.I)
H3SUB=lambda x:H3.sub(lambda m:m.group(1)+'# tmpl-h3 '+m.group(2),x)
def fix_templates(skip):
    # Hiddify haproxy templates (not the loaded cfg itself): comment out h3 alt-svc, backup <f>.bak-h3 once
    for r,_,fs in os.walk('/opt/hiddify-manager/haproxy'):
        for x in fs:
            f=os.path.join(r,x)
            if '.bak' in x or x.endswith(('.tmpl-new','.tmpl-rb')) or os.path.abspath(f) in skip or not os.path.isfile(f): continue
            try: a=open(f).read()
            except Exception: continue
            b=H3SUB(a)
            if b!=a:
                if not os.path.exists(f+'.bak-h3'): shutil.copy2(f,f+'.bak-h3')
                open(f,'w').write(b); print('alt-svc h3 removed from template',f)
ALTC='http-response set-header alt-svc clear'
rule=lambda ind,mode:f'{ind}# BEGIN tmpl-sub\n'+(f'{ind}{ALTC}\n' if mode=='http' else '')+f'{ind}use_backend tmpl_sub_{mode} if {acl}\n{ind}# END tmpl-sub\n'
# Hiddify 10-12: http frontends (h2 over TCP *and* h3/QUIC - Happ macOS/iOS switch to HTTP/3 via Alt-Svc!) + tcp/h1 frontend
NV=re.compile(r'^([ \t]*)use_backend naive(_quic)? if is_naive\n',re.M); m2=f'    use_backend generate_204 if {{ path -i /{cp}/generate_204 }}\n'
if NV.search(t) and t.count(m2)==1:
    t=NV.sub(lambda m:rule(m.group(1),'http')+m.group(0),t); t=t.replace(m2,rule('    ','tcp')+m2); n=2
else:
    L=t.split('\n'); out=[]; n=0; sec=None; mode=None; done=False; dmode='http'
    for i,l in enumerate(L):
        s=l.strip()
        if re.match(r'^(frontend|listen|backend|defaults|global)\b',l):
            sec=l.split()[0]; mode=None; done=False
            if sec=='defaults': mode=None
        if sec=='defaults' and s.startswith('mode '): dmode=s.split()[1]
        if s.startswith('mode ') and sec in ('frontend','listen'): mode=s.split()[1]
        if sec in ('frontend','listen') and not done and re.match(r'use_backend\s+\S+\s+if\b.*\bpath',s):
            ind=l[:len(l)-len(l.lstrip())]; out.append(rule(ind,mode or dmode).rstrip('\n')); done=True; n+=1
        out.append(l)
    t='\n'.join(out)
    if n==0: print('no insertion point found, nothing changed'); sys.exit(1)
t=H3SUB(t)
t=t.rstrip('\n')+'\n\n# BEGIN tmpl-sub\nbackend tmpl_sub_http\n  mode http\n  retries 2\n  retry-on conn-failure empty-response response-timeout\n  option redispatch\n  timeout connect 1s\n  timeout server 8s\n  server s1 127.0.0.1:2099\nbackend tmpl_sub_tcp\n  mode tcp\n  retries 2\n  timeout connect 1s\n  timeout server 8s\n  server s1 127.0.0.1:2099\n# END tmpl-sub\n'
fix_templates({os.path.abspath(F)})
if t!=t0:
    if not os.path.exists(F+'.bak-h3'): shutil.copy2(F,F+'.bak-h3')
    open(F+'.tmpl-new','w').write(t)
    args=[]
    for a in (svc_cfgs() or [F]):
        if os.path.abspath(a)==os.path.abspath(F): a=F+'.tmpl-new'
        elif os.path.isdir(a) and os.path.dirname(os.path.abspath(F))==os.path.abspath(a):
            a=None  # dir include: check new file + siblings
            args+=['-f',F+'.tmpl-new']+sum([['-f',os.path.join(os.path.dirname(F),x)] for x in sorted(os.listdir(os.path.dirname(F))) if x.endswith('.cfg') and os.path.join(os.path.dirname(F),x)!=F],[])
        if a: args+=['-f',a]
    r=subprocess.run(['haproxy','-c']+args,capture_output=True,text=True)
    if r.returncode!=0:
        os.unlink(F+'.tmpl-new'); print('haproxy -c FAILED, not applied:',r.stderr[-300:]); sys.exit(1)
    os.replace(F+'.tmpl-new',F); print('CHANGED')
else: print('UNCHANGED')
