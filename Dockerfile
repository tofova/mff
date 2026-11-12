# Production image for this Next.js app.
# Used by Dokploy (Build Type "Dockerfile") and by any other host that runs containers.
#
# BUILD-TIME values (Dokploy: Environment tab -> "Build-time Arguments").
# Next.js copies every NEXT_PUBLIC_* value into the compiled code while it builds,
# so they must be given at build time. They are public by design:
#   NEXT_PUBLIC_BASE_URL             required, e.g. https://www.garenafreefire.store
#   NEXT_PUBLIC_FIREBASE_VAPID_KEY   required, web push public key
#   NEXT_PUBLIC_IMAGE_HOSTS          optional, extra hosts for the image optimizer
#   NEXT_PUBLIC_RAZORPAY_KEY_ID      optional
# PostHog, all optional. Leave them out and the site keeps sending to the PostHog
# project written in src/lib/analytics/posthog-config.ts. Set them and redeploy to
# move to another PostHog account or to a self-hosted PostHog, with no code change:
#   NEXT_PUBLIC_POSTHOG_KEY          project token, starts with phc_ (never a phx_ key)
#   NEXT_PUBLIC_POSTHOG_HOST         where events are sent, e.g. https://us.i.posthog.com
#   NEXT_PUBLIC_POSTHOG_UI_HOST      the PostHog web app, e.g. https://us.posthog.com
#   NEXT_PUBLIC_POSTHOG_DISABLED     true switches all tracking off
#   Another cloud account in the same region needs only the KEY. A self-hosted
#   PostHog needs the KEY, and HOST and UI_HOST both set to the server's address.
# If you ever add a new NEXT_PUBLIC_* variable, add one more ARG line below and
# one more line in "Build-time Arguments".
#
# RUNTIME values (Dokploy: Environment tab -> "Environment Settings"):
# everything else, e.g. MONGODB_URI, SESSION_SECRET, payment keys, Firebase admin key.
# Secrets are never part of this image.
#
# Try it locally:
#   docker build -t mff \
#     --build-arg NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
#     --build-arg NEXT_PUBLIC_FIREBASE_VAPID_KEY=<key> .
#   docker run --rm -p 3000:3000 -e MONGODB_URI=<uri> -e SESSION_SECRET=<secret> mff

ARG NODE_VERSION=24-slim

# ---------------------------------------------------------------------------
# 1. deps: install the packages exactly as package-lock.json describes them
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# 2. builder: compile the app
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Declared build arguments are visible to the build command below as
# environment variables. They exist only in this stage.
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY
ARG NEXT_PUBLIC_IMAGE_HOSTS
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
# PostHog (optional, see the top of this file)
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_UI_HOST
ARG NEXT_PUBLIC_POSTHOG_DISABLED

# Stop early with a clear message instead of shipping an image whose
# notification links point to localhost or whose push sign-up cannot work.
RUN if [ -z "$NEXT_PUBLIC_BASE_URL" ] || [ -z "$NEXT_PUBLIC_FIREBASE_VAPID_KEY" ]; then \
      echo ""; \
      echo "ERROR: build arguments are missing."; \
      echo "Set NEXT_PUBLIC_BASE_URL and NEXT_PUBLIC_FIREBASE_VAPID_KEY"; \
      echo "(Dokploy: Environment tab -> Build-time Arguments)."; \
      echo ""; \
      exit 1; \
    fi

# PostHog: refuse a secret personal key (the build would ship it to every
# visitor), then say in the build log which PostHog this image will send to.
RUN POSTHOG_TOKEN="$(printf '%s' "${NEXT_PUBLIC_POSTHOG_KEY:-$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN}" | tr -d '\042\047\040')"; \
    case "$POSTHOG_TOKEN" in \
      phx_*) \
        echo ""; \
        echo "ERROR: the PostHog build argument holds a PERSONAL API key (it starts with phx_)."; \
        echo "That key is secret, and this build would ship it to every visitor."; \
        echo "Use the PROJECT token instead. It starts with phc_ (PostHog: Settings -> Project)."; \
        echo ""; \
        exit 1 ;; \
    esac; \
    if [ -n "$POSTHOG_TOKEN" ]; then \
      echo "PostHog: project token from the build arguments: $(printf '%s' "$POSTHOG_TOKEN" | cut -c1-12)..."; \
      case "$POSTHOG_TOKEN" in \
        phc_*) ;; \
        *) echo "PostHog: WARNING: a project token normally starts with phc_. Please check the value." ;; \
      esac; \
    else \
      echo "PostHog: built-in project token (no NEXT_PUBLIC_POSTHOG_KEY build argument)"; \
    fi; \
    echo "PostHog: events go to ${NEXT_PUBLIC_POSTHOG_HOST:-the built-in address}, web app at ${NEXT_PUBLIC_POSTHOG_UI_HOST:-the built-in address}"; \
    case "$NEXT_PUBLIC_POSTHOG_HOST" in \
      ""|*posthog.com*) ;; \
      *) if [ -z "$NEXT_PUBLIC_POSTHOG_UI_HOST" ]; then \
           echo "PostHog: NOTE: NEXT_PUBLIC_POSTHOG_HOST is your own address and NEXT_PUBLIC_POSTHOG_UI_HOST is not set."; \
           echo "PostHog: for a self-hosted PostHog set NEXT_PUBLIC_POSTHOG_UI_HOST to the same address."; \
         fi ;; \
    esac; \
    if [ "$(printf '%s' "$NEXT_PUBLIC_POSTHOG_DISABLED" | tr -d '\042\047\040' | tr 'A-Z' 'a-z')" = "true" ]; then \
      echo "PostHog: tracking is switched OFF by NEXT_PUBLIC_POSTHOG_DISABLED"; \
    fi

# BUILD_STANDALONE switches on `output: 'standalone'` in next.config.ts.
# MONGODB_URI is a placeholder: src/lib/mongodb.ts only checks that the variable
# is not empty while the build loads it, and the build never connects to a
# database. The real value is supplied when the container starts.
RUN BUILD_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1 \
    MONGODB_URI="mongodb://build-placeholder.invalid:27017/placeholder" \
    npm run build

# ---------------------------------------------------------------------------
# 3. runner: the small image that actually runs
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next.js writes its image and page caches below .next at runtime.
RUN mkdir .next && chown node:node .next

# public/ is taken from the builder because the build creates the service
# worker files (sw.js, workbox-*.js) inside it.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Run as the unprivileged "node" user that ships with the base image.
USER node

EXPOSE 3000
CMD ["node", "server.js"]
