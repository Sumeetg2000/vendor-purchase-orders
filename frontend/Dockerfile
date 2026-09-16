FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host so Vite's dev server binds 0.0.0.0 and is reachable from the host.
CMD ["npm", "run", "dev", "--", "--host"]
