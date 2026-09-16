# Node >=22.6 for native TypeScript type-stripping — no build step needed,
# the app runs its .ts source directly (see backend/tsconfig.json).
FROM node:22-bookworm-slim

# Prisma's query/schema engine binaries need OpenSSL to detect the correct
# libssl target at generate/runtime — node:*-slim doesn't include it.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000

# Apply any pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.ts"]
