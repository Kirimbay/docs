#!/bin/bash
# idempotent: open enabled template ports, remove our ACCEPT rules of dropped animals (Hiddify apply may rewrite firewall)
# /etc/tmpl/fw.ports (written by install.sh): OPEN_TCP OPEN_UDP CLOSE_TCP CLOSE_UDP (space separated)
OPEN_TCP="__SOVA__ __UTKA__ __KRAB__ __TIGR__"; OPEN_UDP="__RYBA__"; CLOSE_TCP=""; CLOSE_UDP=""
[ -f /etc/tmpl/fw.ports ] && . /etc/tmpl/fw.ports
for T in iptables ip6tables; do
 for p in $OPEN_TCP; do $T -C INPUT -p tcp --dport $p -j ACCEPT >/dev/null 2>&1 || $T -I INPUT -p tcp --dport $p -j ACCEPT; done
 for p in $OPEN_UDP; do $T -C INPUT -p udp --dport $p -j ACCEPT >/dev/null 2>&1 || $T -I INPUT -p udp --dport $p -j ACCEPT; done
 for p in $CLOSE_TCP; do while $T -D INPUT -p tcp --dport $p -j ACCEPT >/dev/null 2>&1; do :; done; done
 for p in $CLOSE_UDP; do while $T -D INPUT -p udp --dport $p -j ACCEPT >/dev/null 2>&1; do :; done; done
done; exit 0
