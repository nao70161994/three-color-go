// Browser matchmaking adapter. API endpoint must point to a deployed Worker.
export function makeMatchmaker(baseUrl,fetcher=globalThis.fetch){
  let url;
  try {url=new URL(baseUrl);}catch{throw Error('ランダムマッチのサーバーURLが未設定です');}
  if(url.protocol!=='https:' && url.hostname!=='localhost')throw Error('HTTPSが必要です');
  const call=async(path,body)=>{
    const response=await fetcher(url.toString().replace(/\/$/,'')+path,{
      method:body?'POST':'GET',
      headers:body?{'content-type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined,cache:'no-store',
      signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(12000):undefined
    });
    let data;
    try{data=await response.json();}catch{throw Error('サーバーの応答が不正です');}
    if(!response.ok||!data.ok)throw Error(data.error||'マッチング通信エラー');
    return data;
  };
  return {
    join:ticket=>call('/join',{ticket}),
    status:ticket=>call('/status?ticket='+encodeURIComponent(ticket)),
    ready:ticket=>call('/ready',{ticket}),
    leave:ticket=>call('/leave',{ticket})
  };
}
