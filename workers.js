var html404 = `<!DOCTYPE html>
<body>
  <h1>Aurxsiu 404!</h1>
`;

async function handleRequest(request) {
  const requestURL = new URL(request.url);
  const path = requestURL.pathname.split("/")[1];
  console.log("path: " + path);
  console.log("request: " + requestURL.pathname);
  if (!path) {
    //自定义页面
    const html = await fetch(
      "https://xytom.github.io/Url-Shorten-Worker/index.html",
    );
    //首页跳转到指定地址
    //return Response.redirect("https://www.wanuse.com", 302);
    //加载自定义页面
    return new Response(await html.text(), {
      headers: { "content-type": "text/html;charset=UTF-8" },
    });
  } else {
    const value = await DDD.get(path);
    if (value) {
      return new Response(value);
    }
    return new Response(
      html404 + `<h2>` + requestURL.pathname + `</h2></body>`,
      {
        headers: { "content-type": "text/html;charset=UTF-8" },
        status: 404,
      },
    );
  }
}

addEventListener("fetch", async (event) => {
  event.respondWith(handleRequest(event.request));
});
