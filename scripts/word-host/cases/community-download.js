const {fetchCommunityCatalog,downloadCommunityPlugin,searchCommunityPlugins}=await import('/src/plugins/community.ts');
const catalog=await fetchCommunityCatalog();
const item=catalog.find(item=>item.id==='url-into-selection');
must(!!item && catalog.length>1000,'live official catalog contains known editor plugin');
must(searchCommunityPlugins(catalog,'url selection').some(entry=>entry.id===item.id),'live catalog is searchable');
let lastUrl='';
const {connectCommunityDownloader}=await import('/src/plugins/community-connection.ts');
const reader=await connectCommunityDownloader(globalThis.communityConnection);
let bundle;try{bundle=await downloadCommunityPlugin(item,async(url,options)=>{lastUrl=String(url);return fetch(url,options);},reader);}
catch(error){throw new Error(`${lastUrl}: ${error.message}`);}
must(bundle.manifest.id===item.id && bundle.mainJs.length>100 && !bundle.enabled,'live release downloaded without execution');
return {catalog:catalog.length,repo:item.repo,version:bundle.manifest.version,tag:bundle.source.tag,mainBytes:bundle.mainJs.length,executed:false};
