FROM node:24.18.0-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "dev"]
