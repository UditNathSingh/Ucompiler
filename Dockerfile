FROM ubuntu:22.04

# Avoid tzdata interactive prompt during apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, gcc, python (for node-pty native build), and build tools
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    bash \
    python3 \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package info and install
COPY package.json ./
RUN npm install

# Copy source code
COPY . .

# Expose port (Cloud Run sets PORT env var automatically)
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["npm", "start"]
