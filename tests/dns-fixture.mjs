import ipaddr from 'ipaddr.js';
export function decodeQuery(packet) {
  let offset=12;const labels=[];
  while(packet[offset]){const size=packet[offset++];labels.push(packet.subarray(offset,offset+size).toString('ascii'));offset+=size;}
  return {name:labels.join('.'),type:packet.readUInt16BE(offset+1),id:packet.readUInt16BE()};
}
function encodedName(name) {return Buffer.concat([...name.split('.').map(label=>Buffer.concat([Buffer.from([label.length]),Buffer.from(label,'ascii')])),Buffer.from([0])]);}
export function response(query,{answers=[],additional=[],rcode=0,flags=0x8180}={}) {
  const header=Buffer.from(query.subarray(0,12));header.writeUInt16BE(flags|rcode,2);header.writeUInt16BE(answers.length,6);header.writeUInt16BE(0,8);header.writeUInt16BE(additional.length,10);
  const question=decodeQuery(query);
  const record=item=>{
    const owner=item.owner?encodedName(item.owner):Buffer.from([0xc0,0x0c]);
    const type=item.type??question.type,value=item.value;
    const data=type===5?encodedName(value):Buffer.from(ipaddr.parse(value).toByteArray());
    const fields=Buffer.alloc(10);fields.writeUInt16BE(type);fields.writeUInt16BE(1,2);fields.writeUInt32BE(item.ttl??30,4);fields.writeUInt16BE(data.length,8);
    return Buffer.concat([owner,fields,data]);
  };
  return Buffer.concat([header,query.subarray(12),...answers.map(record),...additional.map(record)]);
}
