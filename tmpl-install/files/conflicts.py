#!/usr/bin/python3
# usage: conflicts.py TCPPORT,... UDPPORT,...   -> JSON list of conflicts on template ports
# each: {proto,port,proc,unit,kind: hiddify|service|unknown, keys:[hiddify enable keys to turn off]}
import subprocess,re,json,sys,os
tcp=[int(x) for x in sys.argv[1].split(',') if x]; udp=[int(x) for x in sys.argv[2].split(',') if x]
def sql(q): return subprocess.run(['mysql','-N','-B','hiddifypanel','-e',q],capture_output=True,text=True).stdout
strc=dict(l.split('\t',1) for l in sql("select `key`,value from str_config where child_id=0").splitlines() if '\t' in l)
boolc=dict(l.split('\t',1) for l in sql("select `key`,value from bool_config where child_id=0").splitlines() if '\t' in l)
def keys_for(port):
    k=[]
    for key,v in strc.items():
        if not re.search(r'port',key): continue
        if str(port) not in re.split(r'[,\s]+',v.strip()): continue
        if key in ('tls_ports','http_ports','kcp_ports'): k.append('!'+key); continue
        e='reality_enable' if key=='special_port' else re.sub(r'_(tcp_|udp_)?ports?$','',key)+'_enable'
        k.append(e if e in boolc else '!'+key)
    return k
out=[]
for proto,ports in (('tcp',tcp),('udp',udp)):
    for p in ports:
        o=subprocess.run(['ss','-H','-lnp'+('t' if proto=='tcp' else 'u'),f'sport = :{p}'],capture_output=True,text=True).stdout
        pids=sorted(set(re.findall(r'pid=(\d+)',o)))
        if not o.strip(): continue
        for pid in pids or ['?']:
            proc=(re.search(r'\(\("([^"]+)"',o) or [None,'?'])[1]; unit='?'
            try: unit=(re.findall(r'/([^/]+\.service)',open(f'/proc/{pid}/cgroup').read()) or ['?'])[-1]
            except Exception: pass
            if unit.startswith('tmpl-'): continue
            kind='hiddify' if unit.startswith('hiddify') else ('service' if unit.endswith('.service') and unit!='?' else 'unknown')
            out.append({"proto":proto,"port":p,"proc":proc,"unit":unit,"kind":kind,"keys":keys_for(p) if kind=='hiddify' else []})
print(json.dumps(out))
