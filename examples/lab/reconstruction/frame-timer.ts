/** Serialized diagnostic queue span; each boundary resolves its own query before another submission can reuse it. */
export function createFrameTimer(device:GPUDevice){
  if(!device.features.has('timestamp-query'))return null;
  const query=device.createQuerySet({type:'timestamp',count:2});
  const resolved=device.createBuffer({size:512,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const readback=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  // Some backends elide timestamp-only passes. Both boundaries perform a tiny
  // observable dispatch; the reported span includes these two marker passes.
  const marker=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code:'@group(0) @binding(0) var<storage,read_write> marker:atomic<u32>; @compute @workgroup_size(1) fn main(){atomicAdd(&marker,1u);}'}),entryPoint:'main'}});
  const binding=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:marker}}]});
  let pending=false;
  function boundary(offset:number){const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass({timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});pass.setPipeline(pipeline);pass.setBindGroup(0,binding);pass.dispatchWorkgroups(1);pass.end();encoder.resolveQuerySet(query,0,2,resolved,offset);return encoder;}
  return {
    begin(){if(pending)throw new Error('Frame timer already pending.');pending=true;device.queue.submit([boundary(0).finish()]);},
    async end(){if(!pending)throw new Error('Frame timer not begun.');const encoder=boundary(256);encoder.copyBufferToBuffer(resolved,0,readback,0,8);encoder.copyBufferToBuffer(resolved,264,readback,8,8);device.queue.submit([encoder.finish()]);try{await readback.mapAsync(GPUMapMode.READ);const stamps=new BigUint64Array(readback.getMappedRange());const ms=Number(stamps[1]-stamps[0])/1e6;if(!Number.isFinite(ms)||ms<=0)throw new Error('GPU frame timestamps are invalid; no performance result recorded.');return ms;}finally{readback.unmap();pending=false;}},
    dispose(){query.destroy();resolved.destroy();readback.destroy();marker.destroy();},
  };
}
