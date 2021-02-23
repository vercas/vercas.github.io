---
layout: post
title: Runningg The Lounge Torified with Docker
---

For half a decade I've been using a headless Quassel Core as my IRC client, but its shortcomings have become too much to bear.  
I've looked for better alternatives that can meet my requirements (that have changed since I've started using Quassel), and the closest to my needs seems to be The Lounge.  
Sadly, it ~~is~~was missing one very important feature: the ability to connect through a SOCKS5 proxy.  
In this post I show how I've overcome this limitation, and explain how and why.  

----

## Reasoning

Allow me to start with a rant.  
Quassel is incredible. A lot of features packed into one application.  
One outdated, slow, and bloated application.  
So many features yes no automatic cleaning of message backlogs.  
After years of usage, it renders some operations so incredibly slow, that doing them blocks the daemon for so long, the client loses connection to the daemon, and the daemon loses connection to every IRC server.  
It literally hasn't been updated since I've started using it, and it's by no means stable or bug-free.  

It worked really well for me because I was running it on a rented dedicated server. I didn't have servers at home back then.  
I was running the Quassel client on Windows, where it worked really well and it looked well.  
But then I've also started using the client on Linux, where the experience is significantly worse.  
It looks awful no matter what I do. Its integration with system themes is plainly and simply hostile to the eye.  
It never remembers the layout of the interface, it gets reset to absurd values every time I start the client. Channel list and channel member list are unreadable because they are too small.  
Timestamps in the message list are cut off and the right side fades off when this happens, making less than half the timestamp actually readable. Nicknames are often cut off too, and also faded...  

Also the inability to make link previews in Quassel use a proxy was a major deal-breaker. **Just by accidentally moving the mouse over a link, it makes Quassel access it for generating the preview.**  
**This is a major privacy issue.**  
Unacceptable.
(this can be fixed by torifying the client, but then you need to connect to your Core via Tor as well)

As replacement, I've been looking specifically for either web-based options first, and terminal-based options second.  
The terminal-based clients (many of which are headless) have all the features I could possibly want, except for the basic QoL ones: great looks, link previews, and notifications.  
Why web-based or terminal-based specifically? Well, because they are the most portable interfaces amongst my platforms of choice.  

In the end, I was left with two clients that had feature parity (relative to what I need): IRCCloud and The Lounge.  
I've decided to go with The Lounge because it's self-hosted, putting me in control of my data, and because it simply looks nicer.  

As I've said in the first paragraph, its only shortcoming was the inability to connect to an IRC server via proxy. I have solved this by forcing all of the traffic through a transparent Tor proxy.  
Tor's SOCKS5 proxy is the only proxy I wanted to connect to anyway.  

## Show and Tell

First, here's a `docker-compose.yml` file you can look at:  
```yaml
version: "3.8"

services:
  tor-router:
    image: tor-router
    container_name: tor-router
    restart: always
    cap_add:
      - NET_ADMIN
    dns:
      - 127.0.0.1
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: npm
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
    environment:
      - DB_MYSQL_HOST=npm-db
      - DB_MYSQL_PORT=3306
      - DB_MYSQL_USER=npm
      - DB_MYSQL_PASSWORD=npm
      - DB_MYSQL_NAME=npm
      - DISABLE_IPV6=true
    volumes:
      - /srv/npm/data:/data
      - /srv/npm/certs:/certs
      - /srv/npm/letsencrypt:/etc/letsencrypt
    depends_on:
      - npm-db
  npm-db:
    image: jc21/mariadb-aria:10.4
    container_name: npm-db
    restart: unless-stopped
    environment:
      - MYSQL_ROOT_PASSWORD=npm
      - MYSQL_DATABASE=npm
      - MYSQL_USER=npm
      - MYSQL_PASSWORD=npm
    volumes:
      - /srv/npm/mysql:/var/lib/mysql
  thelounge:
    image: ghcr.io/linuxserver/thelounge
    container_name: thelounge
    restart: always
    network_mode: service:tor-router
    environment:
      - PUID=9002
      - PGID=9002
      - TZ=Europe/London
    volumes:
      - /srv/thelounge:/config
    depends_on:
      - tor-router
  socat-thelounge-in-tor:
    image: alpine/socat
    container_name: socat-thelounge-in-tor
    restart: always
    network_mode: service:tor-router
    volumes:
      - /srv/.sockets:/sockets
    depends_on:
      - tor-router
    command: UNIX-LISTEN:/sockets/thelounge,fork,mode=700 TCP:127.0.0.1:9000
  socat-thelounge-out:
    image: alpine/socat
    container_name: socat-thelounge-out
    restart: always
    volumes:
      - /srv/.sockets:/sockets
    command: TCP-LISTEN:80,fork UNIX-CONNECT:/sockets/thelounge
```

This might look unholy to someone who doesn't quite know what is going on.  
NodeProxyManager is there to provide SSL (e.g. via Let's Encrypt) to The Lounge. This is required for push notifications, and for registering the `irc://` and `ircs://` URI handlers.  
`socat` is necessary to access The Lounge across the different network namespaces of the containers. It uses a Unix domain socket, simply.  
Set up NPM to forward traffic to hostname `socat-thelounge-out` port 80, enable websocket support. Use Let's Encrypt for SSL. Boom, quick maths.  
Keep in mind your hostname (e.g. `thelounge.example.com`) needs to be accessible from the internet, and port 80 on your router needs to be forwarded to your Docker host, if you want to use Let's Encrypt. You can use the features that require HTTPS with self-signed certificates too.  

The magic here is in the `tor-router` image, which is a *slightly* altered version of [this one](https://github.com/flungo-docker/tor-router).  
Simply edit the Dockerfile and change the first line to:  
```Dockerfile
FROM alpine:latest
```
You absolutely want to have the latest Tor, both to get all the security fixes, and to get the new features, such as hidden service protocol v3.  
After making the edit, build it like this:  
```bash
docker build -t tor-router src
```

Just change all the volumes to suit your filesystem structure, change the database passwords, and you can run it.  
**DO NOT CHANGE THE UID/GID OF THELOUNGE TO 9001**, see why down below.  
And you are done.  

## Details

```yaml
    network_mode: service:tor-router
```
This tells Docker that a container is to be run in the network namespace of another (in this case, `tor-router`).  
This means it sees the same network interfaces, it can connect to all the listening ports (even if they are in another container), and it is subject to the same `iptables` rules.  
[This file](https://github.com/flungo-docker/tor-router/blob/master/src/iptables.rules) in the [tor-router repo](https://github.com/flungo-docker/tor-router) is where the magic happens, and the author has generously documented what each rule does.  
Brief overview: all TCP and DNS (UDP port 53) traffic is forwarded to a specific port that the Tor daemon listens to for transparent proxying, and only the Tor daemon (well, anything running with UID 9001) can send traffic to anything else.  
As long as you don't use UID 9001 for a torified service, and you make sure nothing *could* do that without your knowledge, it will work perfectly fine.  

## Bottom Line

I am quite happy with this setup so far. It just works! (famous last words, I know)

