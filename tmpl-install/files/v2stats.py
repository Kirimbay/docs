#!/usr/bin/python3
# minimal gRPC client for v2ray-style StatsService.QueryStats (xray: xray.app.stats.command, sing-box: v2ray.core.app.stats.command)
# usage as module: query(addr, service, pattern, reset) -> {name: value}
import subprocess,struct,sys
def _varint(n):
    b=b''
    while True:
        x=n&0x7f; n>>=7
        b+=bytes([x|0x80]) if n else bytes([x])
        if not n: return b
def _rvarint(b,i):
    s=0;r=0
    while True:
        c=b[i]; i+=1; r|=(c&0x7f)<<s; s+=7
        if not c&0x80: return r,i
def _fields(b):
    i=0
    while i<len(b):
        k,i=_rvarint(b,i); f,w=k>>3,k&7
        if w==0: v,i=_rvarint(b,i)
        elif w==2: l,i=_rvarint(b,i); v=b[i:i+l]; i+=l
        elif w==1: v=b[i:i+8]; i+=8
        elif w==5: v=b[i:i+4]; i+=4
        else: raise ValueError('wire')
        yield f,v
def query(addr,service,pattern='',reset=False,timeout=10):
    req=b'\x0a'+_varint(len(pattern.encode()))+pattern.encode()+(b'\x10\x01' if reset else b'')
    body=b'\x00'+struct.pack('>I',len(req))+req
    r=subprocess.run(['curl','-s','--max-time',str(timeout),'--http2-prior-knowledge','-H','content-type: application/grpc','-H','te: trailers',
        '--data-binary','@-','-D','/dev/stderr',f'http://{addr}/{service}/QueryStats'],input=body,capture_output=True)
    hdr=r.stderr.decode('latin1').lower()
    if r.returncode or 'grpc-status' in hdr and 'grpc-status: 0' not in hdr: raise RuntimeError(f'grpc failed rc={r.returncode} {hdr[-200:]}')
    out={}; b=r.stdout; i=0
    while i+5<=len(b):
        l=struct.unpack('>I',b[i+1:i+5])[0]; m=b[i+5:i+5+l]; i+=5+l
        for f,v in _fields(m):
            if f==1:
                d=dict(_fields(v)); out[d.get(1,b'').decode()]=d.get(2,0)
    return out
XRAY='xray.app.stats.command.StatsService'; SINGBOX='v2ray.core.app.stats.command.StatsService'
if __name__=='__main__':
    print(query(sys.argv[1],XRAY if sys.argv[2]=='xray' else SINGBOX,sys.argv[3] if len(sys.argv)>3 else '', '--reset' in sys.argv))
