/** Shared CPU execution in a separate thread; keep the logic in cpu-engine.js. */
import {selectCpuMove} from './cpu-engine.js';
self.addEventListener('message',({data})=>{
  const {state,level,generation}=data;
  try{
    const {move,decision}=selectCpuMove(state,level,Math.random);
    self.postMessage({generation,move,decision});
  }catch(error){
    self.postMessage({generation,error:String(error?.message||error)});
  }
});
