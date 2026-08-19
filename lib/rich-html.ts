const forbidden = /<(script|iframe|object|embed|form|input|button|textarea|select|link|meta|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
export function sanitizeRichHtml(value:string){
  return value.replace(forbidden,"").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,"").replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi,'$1="#"').slice(0,250000);
}
