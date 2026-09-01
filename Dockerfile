FROM node:24.18.0-bookworm AS application-base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile

FROM ghcr.io/foundry-rs/foundry:v1.7.1 AS contract-builder

USER root
WORKDIR /workspace
COPY --from=application-base /workspace/node_modules ./node_modules
COPY foundry.toml ./foundry.toml
COPY contracts ./contracts
RUN forge build

FROM application-base AS runtime

COPY --from=contract-builder /workspace/contracts/out ./contracts/out

CMD ["pnpm", "dev"]
