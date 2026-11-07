#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <linux/tcp.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

/* Abort a :443 socket that is being closed before a real response was sent.
   HAProxy's content reject uses a FIN; clients then sit on that socket.
   A kernel RST frees both sides. Sockets that already sent >= 400 bytes
   (a certificate, a subscription) keep a normal close. */

static int (*real_close)(int);
static int (*real_shutdown)(int, int);
static int (*real_connect)(int, const struct sockaddr *, socklen_t);

static void init(void) __attribute__((constructor));
static void init(void) {
	real_close = dlsym(RTLD_NEXT, "close");
	real_shutdown = dlsym(RTLD_NEXT, "shutdown");
	real_connect = dlsym(RTLD_NEXT, "connect");
}

static int watched_port(void) {
	const char *e = getenv("RELAY_RST_PORT");
	if (!e || !*e) return 443;
	return atoi(e);
}

static int local_port(int fd) {
	struct sockaddr_storage ss;
	socklen_t len = sizeof(ss);
	if (getsockname(fd, (struct sockaddr *)&ss, &len) != 0)
		return -1;
	if (ss.ss_family == AF_INET)
		return ntohs(((struct sockaddr_in *)&ss)->sin_port);
	if (ss.ss_family == AF_INET6)
		return ntohs(((struct sockaddr_in6 *)&ss)->sin6_port);
	return -1;
}

static int should_abort(int fd) {
	int port = local_port(fd);
	if (port < 0 || port != watched_port())
		return 0;
	struct tcp_info info;
	socklen_t len = sizeof(info);
	if (getsockopt(fd, IPPROTO_TCP, TCP_INFO, &info, &len) != 0)
		return 0;
	if (info.tcpi_state == 10 || info.tcpi_state == 7)
		return 0;
	if (info.tcpi_bytes_sent >= 400)
		return 0;
	return 1;
}

static void abort_rst(int fd) {
	struct sockaddr sa;
	memset(&sa, 0, sizeof(sa));
	sa.sa_family = AF_UNSPEC;
	/* Drop the connection with a RST and keep the fd for HAProxy to close. */
	real_connect(fd, &sa, sizeof(sa));
}

int shutdown(int fd, int how) {
	if (!real_shutdown) init();
	if (should_abort(fd)) {
		abort_rst(fd);
		errno = 0;
		return 0;
	}
	return real_shutdown(fd, how);
}

int close(int fd) {
	if (!real_close) init();
	if (should_abort(fd)) {
		struct linger sl;
		sl.l_onoff = 1;
		sl.l_linger = 0;
		setsockopt(fd, SOL_SOCKET, SO_LINGER, &sl, sizeof(sl));
	}
	return real_close(fd);
}
