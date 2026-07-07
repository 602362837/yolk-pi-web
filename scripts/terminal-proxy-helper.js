#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const net = require("node:net");

const CONNECT_TIMEOUT_MS = 30_000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readContext(path) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") fail("invalid proxy context");
    if (parsed.type !== "socks5" && parsed.type !== "http") fail("unsupported proxy type");
    if (typeof parsed.host !== "string" || !parsed.host || !Number.isInteger(parsed.port)) fail("invalid proxy endpoint");
    return parsed;
  } catch (error) {
    fail(`failed to read proxy context: ${error.message}`);
  }
}

function readExactly(socket, length) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= length) {
        cleanup();
        const head = buffer.subarray(0, length);
        const tail = buffer.subarray(length);
        if (tail.length > 0) socket.unshift(tail);
        resolve(head);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("proxy socket closed"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function readHttpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf("\r\n\r\n");
      if (marker !== -1) {
        cleanup();
        const head = buffer.subarray(0, marker + 4).toString("utf8");
        const tail = buffer.subarray(marker + 4);
        if (tail.length > 0) socket.unshift(tail);
        resolve(head);
      }
      if (buffer.length > 64 * 1024) {
        cleanup();
        reject(new Error("HTTP proxy response is too large"));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function connectSocket(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy(new Error("proxy connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function socks5Connect(socket, context, targetHost, targetPort) {
  const methods = context.username || context.password ? Buffer.from([0x00, 0x02]) : Buffer.from([0x00]);
  socket.write(Buffer.concat([Buffer.from([0x05, methods.length]), methods]));
  const methodReply = await readExactly(socket, 2);
  if (methodReply[0] !== 0x05 || methodReply[1] === 0xff) throw new Error("SOCKS5 proxy rejected authentication methods");

  if (methodReply[1] === 0x02) {
    const username = Buffer.from(String(context.username || ""));
    const password = Buffer.from(String(context.password || ""));
    if (username.length > 255 || password.length > 255) throw new Error("SOCKS5 credentials are too long");
    socket.write(Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([password.length]), password]));
    const authReply = await readExactly(socket, 2);
    if (authReply[1] !== 0x00) throw new Error("SOCKS5 authentication failed");
  }

  const host = Buffer.from(targetHost);
  if (host.length > 255) throw new Error("target host is too long for SOCKS5 domain connect");
  const port = Buffer.alloc(2);
  port.writeUInt16BE(targetPort, 0);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, port]));
  const head = await readExactly(socket, 4);
  if (head[0] !== 0x05 || head[1] !== 0x00) throw new Error(`SOCKS5 connect failed with code ${head[1]}`);
  const atyp = head[3];
  if (atyp === 0x01) await readExactly(socket, 6);
  else if (atyp === 0x03) {
    const len = await readExactly(socket, 1);
    await readExactly(socket, len[0] + 2);
  } else if (atyp === 0x04) await readExactly(socket, 18);
  else throw new Error("SOCKS5 proxy returned invalid address type");
}

async function httpConnect(socket, context, targetHost, targetPort) {
  const authority = `${targetHost}:${targetPort}`;
  const headers = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, "Proxy-Connection: Keep-Alive"];
  if (context.username || context.password) {
    const token = Buffer.from(`${context.username || ""}:${context.password || ""}`).toString("base64");
    headers.push(`Proxy-Authorization: Basic ${token}`);
  }
  socket.write(`${headers.join("\r\n")}\r\n\r\n`);
  const response = await readHttpResponse(socket);
  const statusLine = response.split("\r\n", 1)[0] || "";
  if (!/^HTTP\/\d(?:\.\d)? 2\d\d\b/.test(statusLine)) throw new Error(`HTTP proxy CONNECT failed: ${statusLine}`);
}

async function main() {
  const [contextPath, targetHost, targetPortRaw] = process.argv.slice(2);
  if (!contextPath || !targetHost || !targetPortRaw) fail("usage: terminal-proxy-helper <context.json> <target-host> <target-port>");
  const targetPort = Number(targetPortRaw);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) fail("invalid target port");

  const context = readContext(contextPath);
  const socket = await connectSocket(context.host, context.port);
  try {
    if (context.type === "socks5") await socks5Connect(socket, context, targetHost, targetPort);
    else await httpConnect(socket, context, targetHost, targetPort);
  } catch (error) {
    socket.destroy();
    throw error;
  }

  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.once("close", () => process.exit(0));
}

main().catch((error) => fail(error.message));
