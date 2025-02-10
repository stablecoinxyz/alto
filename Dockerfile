# production ready dockerfile that runs pnpm start
FROM node:20.12.2-alpine3.19

# set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

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

RUN pnpm fetch

# install dependencies
RUN pnpm install -r

# copy source code
RUN pnpm build

# remove dev dependencies
# RUN pnpm clean-modules

# install dependencies
# RUN pnpm install -r

# start app
ENTRYPOINT ["pnpm", "start-base-sepolia"]
