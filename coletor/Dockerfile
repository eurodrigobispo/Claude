# Painel + coletor num contêiner só.
#   docker build -t painel-eleitoral -f coletor/Dockerfile .
#   docker run -d -p 8080:8080 -v painel-feed:/app/feed painel-eleitoral
FROM node:22-alpine
WORKDIR /app
COPY painel ./painel
COPY coletor ./coletor
ENV PORT=8080
EXPOSE 8080
CMD ["node", "coletor/servidor.mjs", "--coletar", "--saida", "/app/feed"]
