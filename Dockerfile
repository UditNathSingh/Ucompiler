FROM ubuntu:22.04

# Avoid tzdata interactive prompt during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, gcc, python (for node-pty native build), and build tools
# Also install specific C libraries requested for compiler support
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    g++ \
    bash \
    python3 \
    build-essential \
    libcurl4-openssl-dev \
    libsqlite3-dev \
    libncurses5-dev \
    libglib2.0-dev \
    libomp-dev \
    libcjson-dev \
    check \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package info and install
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Secure the container by making app files read-only for the execution user
# We create a 'node' user natively in ubuntu
RUN groupadd -r node && useradd -r -g node node || true
RUN chown -R root:root /app && chmod -R 755 /app
USER node

# Expose port (Cloud Run sets PORT env var automatically)
ENV PORT=8080
EXPOSE 3000

# Start server
CMD ["npm", "start"]
