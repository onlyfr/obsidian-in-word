using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
var directory = Path.GetFullPath(args[0]);var certificates = Path.GetFullPath(args[1]);
using var pem = X509Certificate2.CreateFromPemFile(Path.Combine(certificates,"localhost.crt"),Path.Combine(certificates,"localhost.key"));
using var certificate = X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pfx),null,X509KeyStorageFlags.UserKeySet);
var app = HostServer.Build(certificate);using var lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(3));
var token = Guid.NewGuid().ToString("N");
app.Use(async (context,next) => {
 if(context.Request.Path != "/index.html"){await next(context);return;}
 var original=context.Response.Body;using var buffer=new MemoryStream();context.Response.Body=buffer;await next(context);
 var html=System.Text.Encoding.UTF8.GetString(buffer.ToArray());
 var script="<script type=module>const token="+JsonSerializer.Serialize(token)+@";
 const send=async value=>fetch('/acceptance/result',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(value)});
 let last='';Office.onReady(async()=>{await send({id:'ready',ok:true});setInterval(async()=>{
 const response=await fetch('/acceptance/command',{headers:{Authorization:'Bearer '+token}});if(response.status===204)return;
 const job=await response.json();if(job.id===last)return;last=job.id;
 try{const value=await new (Object.getPrototypeOf(async()=>{}).constructor)(job.code)();await send({id:job.id,ok:true,value});}
 catch(error){await send({id:job.id,ok:false,error:String(error)});}
 },250);});</script>";
 context.Response.Body=original;context.Response.ContentLength=null;await context.Response.WriteAsync(html.Replace("</body>",script+"</body>"));
});
app.MapGet("/acceptance/command",(HttpContext c)=>{
 if(c.Request.Headers.Authorization!="Bearer "+token)return Results.StatusCode(403);
 var path=Path.Combine(directory,"command.json");return File.Exists(path)?Results.Content(File.ReadAllText(path),"application/json"):Results.NoContent();
});
app.MapPost("/acceptance/result",async(HttpContext c)=>{
 if(c.Request.Headers.Authorization!="Bearer "+token){c.Response.StatusCode=403;return;}
 using var json=await JsonDocument.ParseAsync(c.Request.Body);await File.AppendAllTextAsync(Path.Combine(directory,"results.jsonl"),json.RootElement.GetRawText()+"\n");
});
app.MapPost("/acceptance/stop",(HttpContext c)=>{if(c.Request.Headers.Authorization!="Bearer "+token)return Results.StatusCode(403);lifetime.Cancel();return Results.Ok();});
File.WriteAllText(Path.Combine(directory,"stop-token"),token);
await app.StartAsync();File.WriteAllText(Path.Combine(directory,"server-ready"),"ready");await app.WaitForShutdownAsync(lifetime.Token);
