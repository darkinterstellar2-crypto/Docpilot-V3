FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy app source
COPY . .

# Create data directories
RUN mkdir -p /data/storage src/DataFiles

# Seed data files from examples (only used on first run, volume overrides after)
RUN cp -n src/DataFiles/users.example.json src/DataFiles/users.json 2>/dev/null || true && \
    cp -n src/DataFiles/projects.example.json src/DataFiles/projects.json 2>/dev/null || true && \
    echo '[]' > src/DataFiles/logs.json && \
    echo '[]' > src/DataFiles/sessions-log.json && \
    echo '[]' > src/DataFiles/super-log.json && \
    echo '{}' > src/DataFiles/access-control.json

# Expose port
EXPOSE 3000

# Start
CMD ["node", "server.js"]
