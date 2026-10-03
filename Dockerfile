FROM node:20-bullseye

# Install GCC, standard tools, and all the requested C libraries
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    curl \
    libcurl4-openssl-dev \
    libsqlite3-dev \
    libncurses5-dev \
    libglib2.0-dev \
    libomp-dev \
    libcjson-dev \
    check \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Secure the container by making app files read-only for the non-root execution user
RUN chown -R root:root /app && chmod -R 755 /app
USER node

# Expose port and start
EXPOSE 3000
CMD ["npm", "start"]