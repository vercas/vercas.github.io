---
layout: post
title: WireGuard on Pinebook Pro
---

WireGuard is the new and hip VPN protocol that all the cool kids are using these days.  
It's only natural that I want to use it as well, and the only client I really need is my Pinebook Pro.  
As of right now (November 1st 2019) when I'm writing this, it's not trivial to make use of the `wireguard-dkms` package on the PBP.  
Luckily, alternatives exist, and I will explain what and how.  

Now, WireGuard does have official implementations in userland, that should be far easier to use, but right now there's some issues...  
First one is written in Go, and it performs awfully.  
Second one is written in Rust, and it's very new and lacking in features.  

However, the good folks at Cloudflare have written their own implementation in Rust: [BoringTun](https://github.com/cloudflare/boringtun)  
This seems to have all the features I want/need. I literally don't know of any feature that's missing.  

## Compiling on PBP

Ideally this would be as easy to install as `cargo install boringtun`, but it's not...  
Sadly, the versions of `cargo` and `rustc` in Debian are too old to compile (at least) a dependency.  
We need a more recent compiler.  

The first option I tried was, of course, installing latest Rust on the PBP.  
The script they offer on their website is not going to work. It uses `uname -a` to find the current architecture - which fails.  
The issue here is that `uname -a` reports the kernel's architecture, which is AArch64 on the PBP.  
But the userland is 32-bit, therefore `armhf`.  
The right compiler should be [armv7-unknown-linux-gnueabihf](https://static.rust-lang.org/rustup/dist//armv7-unknown-linux-gnueabihf/rust-init). This link is the script that installs the compiler.  

But once again, this doesn't work.  
Every time I run `cargo` it says:
```
error: command failed: 'cargo'
error: caused by: No such file or directory (os error 2)
```
And I don't want to waste my time fixing this one, because there is a far better solution!

## Cross-compiling

Rust makes it ezpz to cross-compile so this is exactly what we're going to do.  
First, install Rust using the instructions on their website. It just works.  

Then you need to grab a toolchain for our target. On Ubuntu 18.04 you'd use:
```bash
sudo apt install gcc-arm-linux-gnueabihf
```
And then grab the tools to compile Rust for your target architecture:
```bash
rustup target add armv7-unknown-linux-gnueabihf
```

You're almost done! The code will now compile **but** it will fail to link. To fix this, you need this config file:  
`$HOME/.cargo/config`  
```
[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
```

Now, in the BoringTun directory (that I assume you checked out locally on an x86 machine or something), do the build:  
```bash
cargo build --bin boringtun --release --target armv7-unknown-linux-gnueabihf
```

Your result is `target/armv7-unknown-linux-gnueabihf/release/boringtun`, and this is the only file you need to copy over to your Pinebook Pro.  

## WireGuard Setup

WireGuard uses a peer-to-peer model and it is incredibly easy to set up compared to literally every other VPN protocol/software I've used before.  
However, without the kernel module, the easy way to set it up (`wg-quick`) doesn't work.  

Install the [wireguard-tools](http://ftp.uk.debian.org/debian/pool/main/w/wireguard/wireguard-tools_0.0.20191012-1_armhf.deb) package (luckily available for armhf):
```bash
cd /tmp
wget http://ftp.uk.debian.org/debian/pool/main/w/wireguard/wireguard-tools_0.0.20191012-1_armhf.deb
sudo dpkg -i wireguard-tools_0.0.20191012-1_all.deb
```
The package might need a dependency: `sudo apt install libmnl0`.  
Feel free to use another Debian mirror.

I assume that you've set up the other peer(s) properly and you're reasonably sure that they work.  
The way I've organized the files for my WireGuard instance is the following:
```
/srv
└── wireguard
    ├── boringtun
    └── wg0
        ├── check.sh
        ├── conf
        ├── err
        ├── log
        ├── start.sh
        └── stop.sh
```

`/srv/wireguard/boringtun` is just the executable built previously.  
`/srv/wireguard/wg0/{err,log}` are used by BoringTun.

`/srv/wireguard/wg0/start.sh`:  
```bash
#!/bin/sh
NAME=wg0
CMD="/srv/wireguard/boringtun $NAME --err /srv/wireguard/$NAME/err --log /srv/wireguard/$NAME/log --disable-drop-privileges 1"

wg show $NAME > /dev/null 2> /dev/null

if [ $? -eq 0 ]; then
	echo "Stopping existing instance." 1>&2
	ip link set $NAME down
	pkill -f "${CMD}"
	sleep 0.3
fi

$CMD
wg setconf $NAME /srv/wireguard/$NAME/conf
ip addr add 192.168.254.2/24 dev $NAME
ip link set $NAME up
```
Here `192.168.254.2/24` should be the IP you want within your WireGuard subnet.  
If you want to add access to more IP ranges (e.g. the *local* network in your home), add `ip route add 192.168.1.0/24 via 192.168.254.1 dev $NAME` where `192.168.1.0/24` is your subnet and `192.168.254.1` is the peer that will be your gateway.  

`srv/wireguard/wg0/stop.sh`:
```bash
#!/bin/sh
NAME=wg0
CMD="/srv/wireguard/boringtun $NAME --err /srv/wireguard/$NAME/err --log /srv/wireguard/$NAME/log --disable-drop-privileges 1"

wg show $NAME > /dev/null 2> /dev/null

if [ $? -eq 0 ]; then
	ip link set $NAME down
	pkill -f "${CMD}"
else
	echo "No instance to stop." 1>&2
fi
```

`srv/wireguard/wg0/check.sh`:
```bash
#!/bin/sh
NAME=wg0

wg show $NAME > /dev/null 2> /dev/null

if [ $? -eq 0 ]; then
	exit 0
else
	exit 1
fi
```

`/srv/wireguard/wg0/conf`:
```
[Interface]
PrivateKey = INSERT_PRIVATE_KEY_HERE

[Peer]
PublicKey = INSERT_PEER_PUBLIC_KEY_HERE
AllowedIPs = 192.168.254.0/24
Endpoint = HOST:PORT
PersistentKeepalive = 25
```
`INSERT_PRIVATE_KEY_HERE` should be replaced with a private key, as generated by `wg genkey`.  
`INSERT_PEER_PUBLIC_KEY_HERE` should be the public key of your peer.  
`192.168.254.0/24` should be your VPN subnet. Append `, 192.168.1.0/24` after it if you also want LAN access, for example.  
`HOST:PORT` should be the host (IP or domain) and WireGuard port of the peer.  

You can add as many peers as you need there. If you do, I assume you already know how to set them up.  

Once you've started your interface with the script above, you can find your public key with the `wg show` command (or just `wg`):  
```
# wg
interface: wg1
  public key: YOUR_PUBLIC_KEY_HERE
  private key: (hidden)
  listening port: 42069

peer: YOUR_PEER_PUBLIC_KEY_HERE
  endpoint: HOST:PORT
  allowed ips: 192.168.1.0/24, 192.168.254.0/24
  latest handshake: 20 seconds ago
  transfer: 10.66 KiB received, 10.15 KiB sent
  persistent keepalive: every 25 seconds
```

## Plumbing

Naturally, I'd like to connect to WireGuard when I'm at work and disconnect when I am not.  
I don't need to connect to WireGuard while I'm at home because my router will route traffic from LAN to the WireGuard subnet.

So I've written two scripts for this. Which are kind of untested, because I'm writing something far more complex in Lua to be able to handle wireless virtual interfaces.  

`/etc/network/if-up.d/wg0`:
```bash
#!/bin/bash
if [ "${IFACE}" == "wlan0" -a "${ADDRFAM}" == "inet" ]; then
        SSID="$(iwgetid "${IFACE}" -r)"

        case "${SSID}" in
                work-network)
                        /srv/wireguard/wg0/start.sh
                        ;;
                *)
                        # nothing
                        ;;
        esac
fi
```

`/etc/network/if-down.d/wg0`:
```bash
#!/bin/sh
if [ "${IFACE}" == "wlan0" -a "${ADDRFAM}" == "inet" ]; then
        /srv/wireguard/wg0/stop.sh
fi
```

## Observations

BoringTun fails to drop privileges for some reason. That's why I added `--disable-drop-privileges 1`.  
No idea how to fix this.  

I still haven't set up DNS properly. I will solve this issue. Sometime.  

If you connect to your home VPN from within the home network itself, it's gonna be icky. Ergo the scripts above.  

## Performance

Using `iperf` from my home network (the peer is my gateway's WAN IP, not the LAN IP), it maxes out my upload speed.  
I get roughly 14 Mbps and BoringTun uses 25-40% CPU time of a Cortex-A53.  
This was from my PBP to one of the servers in my LAN.  

However, if I change my settings to connect to my gateway's LAN IP, and do `iperf` to the gateway itself over the WireGuard network, results are a bit different.  
I get 44 Mbps and BoringTun uses multiple processes (threads?) to do its work. None of the threads go above 40% or so usage.  
And I get 46 Mbps to my gateway over plain 802.11n  

So, I am very satisfied with the performance and efficiency so far.  

When idling, BoringTun uses no CPU time at all.  

## Sources

First of all, there's the [WireGuard website](https://www.wireguard.com/) with quite a bit of information.  
And of course, the ArchWiki has [a page on WireGuard](https://wiki.archlinux.org/index.php/WireGuard) as well.  
