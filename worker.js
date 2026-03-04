/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env, ctx) {
    // You can view your logs in the Observability dashboard
    console.info({ message: "Aurxsiu Worker received a request!" });

    const requestURL = new URL(request.url).pathname;
    console.info({ requestURL: requestURL });

    switch (requestURL.split("/")[1]) {
      case "push":
        return new Response("push");
      case "get":
        return new Response("push");
      default:
        return new Response("Hello World! Aurxsiu");
    }
  },
};
