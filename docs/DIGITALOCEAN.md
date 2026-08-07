# WEWE ERP on DigitalOcean — Droplet + Docker Compose

Gets the whole stack (PostgreSQL + API + web) live on one droplet, reachable at
`http://<droplet-ip>`, with the demo organisation seeded automatically on first boot.
No manual database steps — `docker compose up` does everything.

> This runs plain HTTP on the droplet IP — fine for a private trial. Add a domain + HTTPS
> before real donor data (final section). Until then the demo password `Password1!` and
> non-secure cookies are acceptable *only* because nothing real is in it yet.

---

## 1. Create the droplet
In the DigitalOcean console → **Create → Droplets**:
- **Image:** Ubuntu 24.04 LTS
- **Size:** Basic → Regular → **2 vCPU / 4 GB** (`s-2vcpu-4gb`, ~$24/mo). 4 GB matters — the
  first build compiles TypeScript and Vite; 2 GB can OOM. (A 2 GB droplet works only if you
  add swap — see step 2b.)
- **Region:** closest to WEWE's users (e.g. `LON1` or `FRA1` for Nigeria).
- **Authentication:** add your SSH key.
- Create, then copy the droplet's **public IP**.

## 2. First-time server prep
SSH in:
```bash
ssh root@<droplet-ip>
```
Install Docker + Compose:
```bash
apt-get update && apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```
**2b. (only if you chose a 2 GB droplet)** add swap so the build doesn't OOM:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
Firewall — allow SSH + HTTP only:
```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw --force enable
```

## 3. Get the code onto the droplet
**Option A — from the source zip** (you already have `wewe-erp-source.zip` locally):
```bash
# on your Mac:
scp ~/Projects/wewe-erp/wewe-erp-source.zip root@<droplet-ip>:/root/
# on the droplet:
mkdir -p /opt/wewe-erp && cd /opt/wewe-erp && unzip -q /root/wewe-erp-source.zip
```
**Option B — from a git remote** (if you push the repo to GitHub first):
```bash
cd /opt && git clone https://github.com/<you>/wewe-erp.git && cd wewe-erp
```

## 4. Configure + launch
```bash
cd /opt/wewe-erp            # (Option A: this is where you unzipped)
cp .env.example .env
# set a STRONG DB_PASSWORD — this is the only value you must change:
sed -i "s/change-me-to-something-strong/$(openssl rand -hex 24)/" .env
docker compose up -d --build
```
The first build takes ~5–10 min (it compiles the API and the web bundle, and installs the
OCR engine). Watch it come up:
```bash
docker compose logs -f api      # look for: [entrypoint] seeding demo organisation… then "listening on :3001"
```
Ctrl-C to stop tailing (the containers keep running).

## 5. Open it
```
http://<droplet-ip>/?as=finance
```
Sign in **ibrahim.musa@wewe.org** / **Password1!**. Swap persona in the URL:
`?as=supervisor | initiator | md | audit | hr | procurement | admin | extaudit`.

That's it — the database was created, migrated, and seeded automatically by the API
container's entrypoint (verified: it applies the schema, seeds 11 demo users on an empty DB,
and skips seeding on every later restart).

---

## Day-2 operations
```bash
cd /opt/wewe-erp
docker compose ps                 # status
docker compose logs -f api        # API logs
docker compose restart api        # restart a service
docker compose down               # stop everything (data persists in the pgdata volume)
docker compose up -d --build      # after pulling new code
```
Backups (the DB + uploaded documents live in named volumes):
```bash
docker compose exec -T db pg_dump -U wewe wewe_erp | gzip > /root/wewe-$(date +%F).sql.gz
```
Add that to cron (`crontab -e`): `15 1 * * * cd /opt/wewe-erp && docker compose exec -T db pg_dump -U wewe wewe_erp | gzip > /root/wewe-$(date +\%F).sql.gz`
and copy the dumps off-droplet (DO Spaces via `rclone`, or `scp` on a schedule).

## Updating the demo → a real organisation
When you're ready to go from demo to real data:
1. Set `SEED_DEMO=0` in `.env` and `docker compose down -v` (⚠ wipes the demo DB), then `up -d`.
2. Bootstrap a real admin (one-off), then build departments/users/budgets in-app as SYSTEM_ADMIN.
3. **Change every password.** `Password1!` must never guard real data.

## Adding a domain + HTTPS (do this before real data)
1. Point an A-record (`erp.weweng.org → <droplet-ip>`).
2. Put **Caddy** in front for automatic Let's Encrypt TLS (reverse-proxy `:443 → web:80`), or
   use a DigitalOcean Load Balancer with a managed cert.
3. In `.env` set `COOKIE_SECURE=1`, `WEB_ORIGIN=https://erp.weweng.org`, `WEB_PORT=8080`
   (Caddy takes 80/443), then `docker compose up -d`.
4. Re-run the security items in `docs/SECURITY_ASSESSMENT.md` against the HTTPS origin, and
   commission the independent penetration test before onboarding WEWE's real records.

## Notes
- The API is **not** exposed to the internet directly — only nginx (the web container) is,
  and it proxies `/v1` and `/docs` to the API over the internal Docker network. Same-origin,
  so session cookies work without CORS gymnastics.
- The web image rebuilds only after a byte-for-byte check that the design bundle is unmodified
  (`check-design-verbatim.sh` runs inside the build — a tampered design fails the image).
