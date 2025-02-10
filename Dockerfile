# production ready dockerfile that runs pnpm start
FROM node:20.12.2-alpine3.19

# set up railway vars
ARG RAILWAY_ENVIRONMENT
ARG ALTO_BASE_SEPOLIA_RPC_URL
ARG ALTO_EXECUTOR_PRIVATE_KEYS
ARG ALTO_UTILITY_PRIVATE_KEY

# set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ envsubst

# Install pnpm using corepack
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

# Copy workspace config first
COPY pnpm-workspace.yaml ./

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Copy all workspace package.json files
COPY src/package.json ./src/
COPY scripts/localDeployer/package.json ./scripts/localDeployer/

# copy source code
COPY . .

# copy config template
COPY config.baseSepolia.json.template ./config.baseSepolia.json.template

RUN pnpm fetch

# install dependencies
RUN pnpm install -r

# copy source code
RUN pnpm build

# remove dev dependencies
# RUN pnpm clean-modules

# install dependencies
# RUN pnpm install -r

# Run envsubst < config.baseSepolia.json.template > config.baseSepolia.json
RUN envsubst < config.baseSepolia.json.template > config.baseSepolia.json

# start app
# ENTRYPOINT ["pnpm", "start-base-sepolia"]

# sleep infinity
CMD ["tail", "-f", "/dev/null"]
