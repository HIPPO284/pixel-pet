FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/data PUBLIC_DIR=/app/public
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
