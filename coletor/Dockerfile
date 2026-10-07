# Painel + coletor num contêiner só.
#   docker build -t painel-eleitoral -f coletor/Dockerfile .
#   docker run -d -p 8080:8080 -v painel-feed:/app/feed painel-eleitoral
FROM node:22-alpine
WORKDIR /app
COPY painel ./painel
COPY coletor ./coletor
RUN mkdir -p /app/feed && chown node:node /app/feed
ENV PORT=8080
EXPOSE 8080
# nasce como root só para acertar o dono do volume do feed (que uma versão
# anterior gravou como root) e passa para o usuário node (--usuario)
CMD ["node", "coletor/servidor.mjs", "--coletar", "--saida", "/app/feed", "--usuario", "node"]
