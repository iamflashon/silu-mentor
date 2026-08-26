"use client";

import { useEffect, useRef, useState } from "react";
import { unzipSync, strFromU8 } from "fflate";

const symbols = ["°C","℃","α","β","γ","δ","μ","λ","±","×","÷","≠","≤","≥","≈","→","←","↔","％","‰","✓","✕","①","②","③","④"];

function normalizeTemperature(value:string){
  return value.replace(/(\d+(?:\.\d+)?)\s*(?:[oº°]\s*)?C(?=\s|冷|熱|保存|培養|$|<)/giu,"$1°C");
}

function cleanOfficeHtml(value:string){
  return value.replace(/<!--([\s\S]*?)-->/g,"").replace(/<(meta|link|style)[^>]*>[\s\S]*?<\/\1>/gi,"").replace(/\s(class|style|lang)=("[^"]*"|'[^']*')/gi,"");
}

function removeBackgroundColors(root:ParentNode){
  root.querySelectorAll<HTMLElement>("*").forEach(element=>{
    element.style.removeProperty("background");
    element.style.removeProperty("background-color");
    element.removeAttribute("bgcolor");
  });
}

function normalizeDoubleUnderlines(root:ParentNode){
  root.querySelectorAll<HTMLElement>("span,[style]").forEach(element=>{
    const borderBottom=element.style.borderBottom||element.style.getPropertyValue("border-bottom");
    if(element.style.textDecorationStyle!=="double"&&!/\bdouble\b/i.test(borderBottom)&&!element.dataset.doubleUnderline)return;
    element.dataset.doubleUnderline="true";
    element.style.textDecoration="none";
    element.style.borderBottom="3px double currentColor";
    element.style.paddingBottom="1px";
  });
}

function cropStructureDiagrams(root:ParentNode){
  root.querySelectorAll<SVGSVGElement>("figure[data-structure-diagram=true] svg").forEach(svg=>{const circles=[...svg.querySelectorAll("circle")].map(circle=>({x:Number(circle.getAttribute("cx")),y:Number(circle.getAttribute("cy"))})).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));if(!circles.length)return;const minX=Math.min(...circles.map(point=>point.x))-48,maxX=Math.max(...circles.map(point=>point.x))+48,minY=Math.min(...circles.map(point=>point.y))-48,maxY=Math.max(...circles.map(point=>point.y))+48,width=Math.max(180,maxX-minX),height=Math.max(140,maxY-minY);svg.setAttribute("viewBox",`${minX} ${minY} ${width} ${height}`);const figure=svg.closest<HTMLElement>("figure[data-structure-diagram=true]");const displayPercent=Math.min(100,Math.max(30,Number(figure?.dataset.displayPercent)||70));if(figure){figure.dataset.displayPercent=String(displayPercent);figure.style.width=`${displayPercent}%`;figure.style.maxWidth="100%"}svg.style.width="100%";svg.style.height="auto"})
}

function editorHtml(root:HTMLElement){
  const clone=root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-table-editor-selected]").forEach(element=>element.removeAttribute("data-table-editor-selected"));
  clone.querySelectorAll<HTMLElement>("[data-quality-warning]").forEach(element=>element.replaceWith(document.createTextNode(element.dataset.qualityOriginal??element.textContent??"")));
  return clone.innerHTML;
}

function qualityEditorHtml(value:string){
  const marker=(text:string,kind:string,original=text)=>`<mark class="quality-editor-warning ${kind}" data-quality-warning="true" data-quality-original="${original.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}">${text}</mark>`;
  return String(value||"")
    .replace(/([\u4e00-\u9fff])(?:\s*<br\s*\/?\s*>\s*)(?=[\u4e00-\u9fff])/giu,(_,before)=>`${before}${marker("↵","linebreak","")}<br>`)
    .split(/(<[^>]+>)/g)
    .map(part=>part.startsWith("<")?part:part
      .replace(/[\uE000-\uF8FF�]/gu,char=>marker(`⚠ U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4,"0")}`,"garbled",char))
      .replace(/([\u4e00-\u9fff])\r?\n\s*(?=[\u4e00-\u9fff])/gu,(_,before)=>`${before}${marker("↵","linebreak","")}\n`)
      .replace(/([\u4e00-\u9fff])([ \t]{2,})(?=[\u4e00-\u9fff])/gu,(_,before,space)=>`${before}${marker("␠","spacing",space)}`))
    .join("");
}

function TableSizeControl({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}){
  const [current,setCurrent]=useState(value);
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>{setCurrent(value);setDraft(String(value))},[value]);
  function update(next:number){const safe=Math.min(max,Math.max(min,Number.isFinite(next)?Math.round(next):min));setCurrent(safe);setDraft(String(safe));onChange(safe)}
  function commitDraft(){const parsed=Number(draft);if(draft.trim()===""||!Number.isFinite(parsed)){setDraft(String(current));return}update(parsed)}
  return <div className="table-size-control"><b>{label}</b><input aria-label={`${label}滑桿`} type="range" min={min} max={max} step="1" value={current} onChange={event=>update(Number(event.currentTarget.value))}/><button type="button" aria-label={`${label}減少 1%`} onClick={()=>update(current-1)}>−</button><label><input aria-label={`${label}百分比`} type="number" min={min} max={max} step="1" value={draft} onChange={event=>setDraft(event.currentTarget.value)} onBlur={commitDraft} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur()}}/><span>%</span></label><button type="button" aria-label={`${label}增加 1%`} onClick={()=>update(current+1)}>＋</button></div>
}

function TablePixelControl({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}){
  const [current,setCurrent]=useState(value);
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>{setCurrent(value);setDraft(String(value))},[value]);
  function update(next:number){const safe=Math.min(max,Math.max(min,Number.isFinite(next)?Math.round(next):min));setCurrent(safe);setDraft(String(safe));onChange(safe)}
  function commitDraft(){const parsed=Number(draft);if(draft.trim()===""||!Number.isFinite(parsed)){setDraft(String(current));return}update(parsed)}
  return <div className="table-size-control"><b>{label}</b><input aria-label={`${label}滑桿`} type="range" min={min} max={max} step="1" value={current} onChange={event=>update(Number(event.currentTarget.value))}/><button type="button" aria-label={`${label}減少 1px`} onClick={()=>update(current-1)}>−</button><label><input aria-label={`${label}像素`} type="number" min={min} max={max} step="1" value={draft} onChange={event=>setDraft(event.currentTarget.value)} onBlur={commitDraft} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur()}}/><span>px</span></label><button type="button" aria-label={`${label}增加 1px`} onClick={()=>update(current+1)}>＋</button></div>
}

export function RichQuestionEditor({label,value,onChange,compact=false,category="medtech",highlightIssues=true}:{label:string;value:string;onChange:(value:string)=>void;compact?:boolean;category?:"medtech"|"accounting"|"data-structure";highlightIssues?:boolean}){
  const ref=useRef<HTMLDivElement>(null); const fileRef=useRef<HTMLInputElement>(null); const selectionRef=useRef<Range|null>(null); const imageFiles=useRef(new Map<string,File>()); const svgHistory=useRef<string[]>([]); const svgFuture=useRef<string[]>([]); const [showSymbols,setShowSymbols]=useState(false); const [showTableGrid,setShowTableGrid]=useState(false); const [showBorderPicker,setShowBorderPicker]=useState(false); const [borderWidth,setBorderWidth]=useState<1|2|3>(1); const [gridSize,setGridSize]=useState({rows:3,cols:4}); const [selectedCell,setSelectedCell]=useState<HTMLTableCellElement|null>(null); const [selectedCells,setSelectedCells]=useState<HTMLTableCellElement[]>([]); const [selectedImage,setSelectedImage]=useState<HTMLImageElement|null>(null); const [selectedDiagram,setSelectedDiagram]=useState<SVGSVGElement|null>(null); const [selectedSvgItem,setSelectedSvgItem]=useState<Element|null>(null); const [svgItemText,setSvgItemText]=useState(""); const [diagramMode,setDiagramMode]=useState<"select"|"connect">("select"); const [connectionStart,setConnectionStart]=useState<SVGGElement|null>(null); const [newEdgeDirected,setNewEdgeDirected]=useState(false); const [uploading,setUploading]=useState(false); const [convertingTable,setConvertingTable]=useState(false); const [convertingDiagram,setConvertingDiagram]=useState(false); const [structureType,setStructureType]=useState(""); const [formatState,setFormatState]=useState({bold:false,italic:false,underline:false,unorderedList:false,alignment:"left" as "left"|"center"|"right"});
  const [addSvgTextMode,setAddSvgTextMode]=useState(false);
  function rememberSelection(){const selection=window.getSelection();if(!selection||!selection.rangeCount||!ref.current)return;const range=selection.getRangeAt(0);if(ref.current.contains(range.commonAncestorContainer))selectionRef.current=range.cloneRange()}
  function restoreSelection(){const canvas=ref.current;if(!canvas)return;canvas.focus();const selection=window.getSelection();const range=selectionRef.current;if(selection&&range&&canvas.contains(range.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(range)}}
  function clearSelection(){window.getSelection()?.removeAllRanges();selectionRef.current=null;setFormatState({bold:false,italic:false,underline:false,unorderedList:false,alignment:"left"})}
  useEffect(()=>{const handlePointerDown=(event:PointerEvent)=>{const target=event.target as Element|null;if(ref.current?.contains(target))return;if(target?.closest(".rich-toolbar,.symbol-palette,.table-grid-picker,.table-context-toolbar"))return;clearSelection()};document.addEventListener("pointerdown",handlePointerDown);return()=>document.removeEventListener("pointerdown",handlePointerDown)},[]);
  function currentAlignment():"left"|"center"|"right"{
    const anchor=window.getSelection()?.anchorNode;
    let element:HTMLElement|null=anchor instanceof HTMLElement?anchor:anchor?.parentElement??null;
    while(element&&element!==ref.current){
      const alignment=window.getComputedStyle(element).textAlign;
      if(alignment==="center"||alignment==="right"||alignment==="left")return alignment;
      element=element.parentElement;
    }
    return "left";
  }
  function refreshFormatState(){try{setFormatState({bold:document.queryCommandState("bold"),italic:document.queryCommandState("italic"),underline:document.queryCommandState("underline"),unorderedList:document.queryCommandState("insertUnorderedList"),alignment:currentAlignment()})}catch{setFormatState({bold:false,italic:false,underline:false,unorderedList:false,alignment:"left"})}}
  useEffect(()=>{const normalized=normalizeTemperature(value||"");if(ref.current&&normalizeTemperature(editorHtml(ref.current))!==normalized){ref.current.innerHTML=highlightIssues?qualityEditorHtml(normalized):normalized;normalizeDoubleUnderlines(ref.current);setSelectedCell(null);setSelectedCells([])}if(ref.current)cropStructureDiagrams(ref.current)},[value,highlightIssues]);
  function sync(){const normalized=normalizeTemperature(ref.current?editorHtml(ref.current):"");onChange(normalized);rememberSelection()}
  function command(name:string,arg?:string){restoreSelection();const before=ref.current?.innerHTML??"";document.execCommand(name,false,arg);if(name==="insertUnorderedList"&&ref.current&&ref.current.innerHTML===before){document.execCommand("insertHTML",false,"<ul><li><br></li></ul>")}rememberSelection();sync();refreshFormatState()}
  function doubleUnderline(){
    restoreSelection();
    const selection=window.getSelection();
    if(!selection||!selection.rangeCount)return;
    const range=selection.getRangeAt(0);
    if(!ref.current?.contains(range.commonAncestorContainer))return;
    const anchor=selection.anchorNode instanceof HTMLElement?selection.anchorNode:selection.anchorNode?.parentElement;
    const candidates=[...ref.current.querySelectorAll<HTMLElement>("[data-double-underline=true],span[style]")].filter(item=>item.dataset.doubleUnderline==="true"||item.style.textDecorationStyle==="double"||/\bdouble\b/i.test(item.style.borderBottom||item.style.getPropertyValue("border-bottom")));
    const current=anchor?.closest<HTMLElement>("[data-double-underline=true],span[style]");
    const matched=candidates.filter(item=>current===item||(!selection.isCollapsed&&range.intersectsNode(item)));
    if(matched.length){
      matched.forEach(item=>{
        item.removeAttribute("data-double-underline");
        item.style.removeProperty("border-bottom");
        item.style.removeProperty("padding-bottom");
        item.style.removeProperty("text-decoration");
        item.style.removeProperty("text-decoration-style");
        if(item.tagName==="SPAN"&&!item.getAttribute("style"))item.replaceWith(...Array.from(item.childNodes));
      });
      clearSelection();sync();return;
    }
    if(selection.isCollapsed)return;
    const wrapper=document.createElement("span");
    wrapper.dataset.doubleUnderline="true";
    wrapper.setAttribute("style","text-decoration:none; border-bottom:3px double currentColor; padding-bottom:1px;");
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    selection.removeAllRanges();
    const next=document.createRange();next.selectNodeContents(wrapper);selection.addRange(next);
    rememberSelection();sync();
  }
  async function upload(file:File){
    if(!file.type.startsWith("image/"))return; setUploading(true);
    const form=new FormData();form.set("file",file);const response=await fetch(category==="accounting"?"/api/accounting/admin/question-assets":"/api/medtech/admin/question-assets",{method:"POST",body:form});const data=await response.json() as {url?:string;error?:string};
    if(response.ok&&data.url){imageFiles.current.set(data.url,file);command("insertImage",data.url)}else alert(data.error||"圖片上傳失敗");setUploading(false);
  }
  async function convertSelectedImage(){const image=selectedImage;if(!image||!ref.current)return;let file=imageFiles.current.get(image.getAttribute("src")||"");if(!file){try{const response=await fetch(image.src);const blob=await response.blob();file=new File([blob],"pasted-content.png",{type:blob.type||"image/png"})}catch{file=undefined}}if(!file){alert("找不到這張圖片的原始檔，請重新貼上圖片後再試。");return}setConvertingTable(true);const form=new FormData();form.set("file",file);try{const response=await fetch(category==="accounting"?"/api/accounting/admin/table-from-image":"/api/medtech/admin/table-from-image",{method:"POST",body:form});const data=await response.json() as {html?:string;error?:string;confidence?:string;note?:string;usage?:{inputTokens?:number;outputTokens?:number;cachedTokens?:number;estimatedCostUsd?:number}};if(!response.ok||!data.html)throw new Error(data.error||"圖片辨識失敗");const holder=document.createElement("div");holder.innerHTML=data.html;removeBackgroundColors(holder);normalizeDoubleUnderlines(holder);image.replaceWith(...Array.from(holder.childNodes));sync();setSelectedImage(null);const usage=data.usage;alert(`${data.note||"已轉成可編輯內容。"}（${data.confidence||"medium"} 信心度）\n\n本次用量：輸入 ${(usage?.inputTokens??0).toLocaleString()}、輸出 ${(usage?.outputTokens??0).toLocaleString()} tokens；估算 US$ ${(usage?.estimatedCostUsd??0).toFixed(6)}。已累積至總管理編輯成本。`)}catch(error){alert(error instanceof Error?error.message:"圖片辨識失敗")}finally{setConvertingTable(false)}}
  async function convertSelectedDiagram(){const image=selectedImage;if(!image||!ref.current)return;let file=imageFiles.current.get(image.getAttribute("src")||"");if(!file){try{const response=await fetch(image.src);const blob=await response.blob();file=new File([blob],"data-structure-content.png",{type:blob.type||"image/png"})}catch{file=undefined}}if(!file){alert("找不到圖片原始檔，請重新貼上後再試。");return}setConvertingDiagram(true);const form=new FormData();form.set("file",file);try{const response=await fetch("/api/data-structure/admin/diagram-from-image",{method:"POST",body:form});const data=await response.json() as {html?:string;error?:string;confidence?:string;nodes?:unknown[];edges?:unknown[];warnings?:string[]};if(!response.ok||!data.html)throw new Error(data.error||"資構內容辨識失敗");const holder=document.createElement("div");holder.innerHTML=data.html;image.replaceWith(...Array.from(holder.childNodes));sync();setSelectedImage(null);alert(`資構內容已轉換（${data.confidence||"medium"} 信心度）${data.nodes?.length?`：SVG ${data.nodes.length} 個節點、${data.edges?.length??0} 條邊`:"：已保留文字與表格"}。${data.warnings?.length?`有 ${data.warnings.length} 項需核對。`:"請與左側原稿核對。"}`)}catch(error){alert(error instanceof Error?error.message:"資構內容辨識失敗")}finally{setConvertingDiagram(false)}}
  function clearBackgroundColors(){if(!ref.current)return;removeBackgroundColors(ref.current);sync()}
  async function paste(event:React.ClipboardEvent<HTMLDivElement>){
    const image=[...event.clipboardData.items].find(item=>item.type.startsWith("image/"))?.getAsFile();
    if(image){event.preventDefault();await upload(image);return}
    const html=event.clipboardData.getData("text/html");if(html){event.preventDefault();restoreSelection();document.execCommand("insertHTML",false,cleanOfficeHtml(html));rememberSelection();sync()}
  }
  function insertTable(rows:number,cols:number){const cells=Array.from({length:rows},()=>`<tr>${Array.from({length:cols},()=>"<td><br></td>").join("")}</tr>`).join("");command("insertHTML",`<table><tbody>${cells}</tbody></table><p><br></p>`);setShowTableGrid(false)}
  function selectTableCells(cell:HTMLTableCellElement,event:React.MouseEvent<HTMLDivElement>){
    const table=cell.closest("table");if(!table)return;
    let next=[cell];
    if(event.shiftKey&&selectedCell?.closest("table")===table){
      const firstRow=(selectedCell.parentElement as HTMLTableRowElement).rowIndex,lastRow=(cell.parentElement as HTMLTableRowElement).rowIndex;
      const minRow=Math.min(firstRow,lastRow),maxRow=Math.max(firstRow,lastRow),minCol=Math.min(selectedCell.cellIndex,cell.cellIndex),maxCol=Math.max(selectedCell.cellIndex,cell.cellIndex);
      next=[...table.rows].slice(minRow,maxRow+1).flatMap(item=>[...item.cells].slice(minCol,maxCol+1));
    }else if((event.ctrlKey||event.metaKey)&&selectedCells.every(item=>item.closest("table")===table)){
      next=selectedCells.includes(cell)?selectedCells.filter(item=>item!==cell):[...selectedCells,cell];
      if(!next.length)next=[cell];
    }
    ref.current?.querySelectorAll("[data-table-editor-selected]").forEach(item=>item.removeAttribute("data-table-editor-selected"));
    next.forEach(item=>item.setAttribute("data-table-editor-selected","true"));
    setSelectedCell(cell);setSelectedCells(next);
  }
  function setCellBorder(cell:HTMLTableCellElement,side:"top"|"bottom"|"left"|"right",visible:boolean){
    const property=(`border${side[0].toUpperCase()}${side.slice(1)}`) as "borderTop"|"borderBottom"|"borderLeft"|"borderRight";
    cell.style[property]=visible?`${borderWidth}px solid #517d78`:"0";
    const table=cell.closest("table"),row=cell.parentElement as HTMLTableRowElement|null;if(!table||!row)return;
    const neighbor=side==="left"?cell.previousElementSibling:side==="right"?cell.nextElementSibling:table.rows[row.rowIndex+(side==="top"?-1:1)]?.cells[cell.cellIndex];
    if(neighbor instanceof HTMLElement){const opposite=side==="top"?"borderBottom":side==="bottom"?"borderTop":side==="left"?"borderRight":"borderLeft";neighbor.style[opposite]=visible?`${borderWidth}px solid #517d78`:"0"}
  }
  function changeBorderWidth(width:1|2|3){
    setBorderWidth(width);
    const targets=selectedCells.length?selectedCells:selectedCell?[selectedCell]:[];
    targets.forEach(item=>(["Top","Bottom","Left","Right"] as const).forEach(side=>{const property=`border${side}` as "borderTop"|"borderBottom"|"borderLeft"|"borderRight";const current=item.style[property];if(current&&current!=="0px"&&current!=="0"&&current!=="none")item.style[property]=`${width}px solid #517d78`}));
    if(targets.length)sync();
  }
  function editTable(action:"rowAbove"|"rowBelow"|"deleteRow"|"colLeft"|"colRight"|"deleteCol"|"mergeRight"|"split"|"toggleBorders"|"borderTop"|"borderBottom"|"borderInsetBottom"|"borderLeft"|"borderRight"|"borderOuter"|"borderInner"|"borderAll"|"borderClear"|"alignLeft"|"alignCenter"|"alignRight"|"alignColumnLeft"|"alignColumnCenter"|"alignColumnRight"){
    const cell=selectedCell;if(!cell)return;const row=cell.parentElement as HTMLTableRowElement|null;const table=cell.closest("table");if(!row||!table)return;const cellIndex=cell.cellIndex;
    if(action==="rowAbove"||action==="rowBelow"){const next=row.cloneNode(true) as HTMLTableRowElement;[...next.cells].forEach(item=>item.innerHTML="<br>");row.parentElement?.insertBefore(next,action==="rowAbove"?row:row.nextSibling)}
    if(action==="deleteRow"){if(table.rows.length>1)row.remove();else table.remove();setSelectedCell(null);setSelectedCells([])}
    if(action==="colLeft"||action==="colRight"){[...table.rows].forEach(item=>{const next=item.insertCell(Math.min(item.cells.length,cellIndex+(action==="colRight"?1:0)));next.innerHTML="<br>"})}
    if(action==="deleteCol"){[...table.rows].forEach(item=>{if(item.cells[cellIndex])item.deleteCell(cellIndex)});if(!table.rows[0]?.cells.length)table.remove();setSelectedCell(null);setSelectedCells([])}
    if(action==="mergeRight"){const right=cell.nextElementSibling as HTMLTableCellElement|null;if(right){cell.innerHTML=`${cell.innerHTML}${cell.innerHTML&&right.innerHTML?" ":""}${right.innerHTML}`;cell.colSpan=(cell.colSpan||1)+(right.colSpan||1);right.remove()}}
    if(action==="split"&&cell.colSpan>1){const count=cell.colSpan;cell.colSpan=1;for(let index=1;index<count;index+=1){const next=document.createElement("td");next.innerHTML="<br>";cell.parentElement?.insertBefore(next,cell.nextSibling)}}
    if(action==="toggleBorders"){
      const hidden=table.dataset.borders==="hidden";
      table.dataset.borders=hidden?"visible":"hidden";
      table.style.border=hidden?"":"0";
      table.style.borderCollapse="collapse";
      table.querySelectorAll<HTMLElement>("td,th").forEach(item=>{item.style.border=hidden?"":"0"});
    }
    const targets=selectedCells.length&&selectedCells.every(item=>item.closest("table")===table)?selectedCells:[cell];
    if(action==="borderTop"||action==="borderBottom"||action==="borderLeft"||action==="borderRight"){
      const side=action.replace("border","").toLowerCase() as "top"|"bottom"|"left"|"right";
      const property=(`border${side[0].toUpperCase()}${side.slice(1)}`) as "borderTop"|"borderBottom"|"borderLeft"|"borderRight";
      const currentlyHidden=targets.every(item=>item.style[property]==="0px"||item.style[property]==="0"||item.style[property]==="none"||!item.style[property]);
      targets.forEach(item=>setCellBorder(item,side,currentlyHidden));
    }
    if(action==="borderInsetBottom")targets.forEach(item=>{item.style.borderBottom="0";item.style.backgroundImage=`linear-gradient(#517d78,#517d78)`;item.style.backgroundRepeat="no-repeat";item.style.backgroundPosition="center bottom";item.style.backgroundSize=`calc(100% - 20px) ${borderWidth}px`});
    if(action==="borderAll")targets.forEach(item=>(["top","bottom","left","right"] as const).forEach(side=>setCellBorder(item,side,true)));
    if(action==="borderClear")targets.forEach(item=>{(["top","bottom","left","right"] as const).forEach(side=>setCellBorder(item,side,false));item.style.removeProperty("background-image");item.style.removeProperty("background-repeat");item.style.removeProperty("background-position");item.style.removeProperty("background-size")});
    if(action==="borderOuter"){
      const rows=targets.map(item=>(item.parentElement as HTMLTableRowElement).rowIndex),cols=targets.map(item=>item.cellIndex),minRow=Math.min(...rows),maxRow=Math.max(...rows),minCol=Math.min(...cols),maxCol=Math.max(...cols);
      targets.forEach(item=>{const rowIndex=(item.parentElement as HTMLTableRowElement).rowIndex;if(rowIndex===minRow)setCellBorder(item,"top",true);if(rowIndex===maxRow)setCellBorder(item,"bottom",true);if(item.cellIndex===minCol)setCellBorder(item,"left",true);if(item.cellIndex===maxCol)setCellBorder(item,"right",true)});
    }
    if(action==="borderInner"){
      const chosen=new Set(targets);targets.forEach(item=>{const itemRow=item.parentElement as HTMLTableRowElement;if(item.nextElementSibling&&chosen.has(item.nextElementSibling as HTMLTableCellElement))setCellBorder(item,"right",true);const below=table.rows[itemRow.rowIndex+1]?.cells[item.cellIndex];if(below&&chosen.has(below))setCellBorder(item,"bottom",true)});
    }
    if(action==="alignLeft"||action==="alignCenter"||action==="alignRight")cell.style.textAlign=action.replace("align","").toLowerCase() as "left"|"center"|"right";
    if(action==="alignColumnLeft"||action==="alignColumnCenter"||action==="alignColumnRight"){
      const alignment=action.replace("alignColumn","").toLowerCase() as "left"|"center"|"right";
      [...table.rows].forEach(item=>{const target=item.cells[cellIndex];if(target)target.style.textAlign=alignment});
    }
    sync();
  }
  function resizeTable(percent:number){const table=selectedCell?.closest("table");if(!table)return;table.style.width=`${percent}%`;table.style.tableLayout="fixed";sync()}
  function resizeRows(height:number){
    const rows=new Set((selectedCells.length?selectedCells:selectedCell?[selectedCell]:[]).map(cell=>cell.parentElement as HTMLTableRowElement));
    rows.forEach(row=>{row.style.height=`${height}px`;[...row.cells].forEach(cell=>{cell.style.height=`${height}px`})});
    if(rows.size)sync();
  }
  function resizeDiagram(percent:number){const figure=selectedDiagram?.closest<HTMLElement>("figure[data-structure-diagram=true]");if(!figure||!selectedDiagram)return;figure.dataset.displayPercent=String(percent);figure.style.width=`${percent}%`;figure.style.maxWidth="100%";selectedDiagram.style.width="100%";selectedDiagram.style.height="auto";sync()}
  function clearSvgItemSelection(){selectedDiagram?.querySelectorAll("[data-svg-editor-selected]").forEach(item=>item.removeAttribute("data-svg-editor-selected"));setSelectedSvgItem(null);setSvgItemText("")}
  function rememberSvgChange(){if(!selectedDiagram)return;selectedDiagram.querySelectorAll("[data-svg-editor-selected]").forEach(item=>item.removeAttribute("data-svg-editor-selected"));svgHistory.current.push(selectedDiagram.innerHTML);if(svgHistory.current.length>40)svgHistory.current.shift();svgFuture.current=[]}
  function restoreSvgSnapshot(html:string){if(!selectedDiagram)return;selectedDiagram.innerHTML=html;clearSvgItemSelection();setConnectionStart(null);sync()}
  function undoSvg(){if(!selectedDiagram||!svgHistory.current.length)return;svgFuture.current.push(selectedDiagram.innerHTML);restoreSvgSnapshot(svgHistory.current.pop()!)}
  function redoSvg(){if(!selectedDiagram||!svgFuture.current.length)return;svgHistory.current.push(selectedDiagram.innerHTML);restoreSvgSnapshot(svgFuture.current.pop()!)}
  function svgTextElement(item:Element|null){if(!item)return null;if(item.tagName.toLowerCase()==="text")return item as SVGTextElement;return item.querySelector<SVGTextElement>("text")}
  function selectSvgItem(item:Element|null){selectedDiagram?.querySelectorAll("[data-svg-editor-selected]").forEach(element=>element.removeAttribute("data-svg-editor-selected"));if(item){item.setAttribute("data-svg-editor-selected","true");setSvgItemText(svgTextElement(item)?.textContent||"")}else setSvgItemText("");setSelectedSvgItem(item)}
  function applySvgText(){const text=svgTextElement(selectedSvgItem);if(!text)return;rememberSvgChange();text.textContent=svgItemText;text.setAttribute("fill","#173f5f");selectSvgItem(selectedSvgItem);sync()}
  function deleteSvgItem(){if(!selectedDiagram||!selectedSvgItem)return;rememberSvgChange();if(selectedSvgItem.matches("g[data-node]")){const id=selectedSvgItem.getAttribute("data-node")||"";selectedDiagram.querySelectorAll<SVGGElement>("g[data-edge]").forEach(edge=>{const legacy=edge.getAttribute("data-edge")||"";if(edge.dataset.from===id||edge.dataset.to===id||legacy.startsWith(`${id}-`)||legacy.endsWith(`-${id}`))edge.remove()})}selectedSvgItem.remove();clearSvgItemSelection();sync()}
  function addConnection(endNode:SVGGElement){if(!selectedDiagram)return;if(!connectionStart){setConnectionStart(endNode);selectSvgItem(endNode);return}if(connectionStart===endNode){setConnectionStart(null);selectSvgItem(null);return}const fromCircle=connectionStart.querySelector("circle"),toCircle=endNode.querySelector("circle");if(!fromCircle||!toCircle)return;rememberSvgChange();const x1=Number(fromCircle.getAttribute("cx")),y1=Number(fromCircle.getAttribute("cy")),x2=Number(toCircle.getAttribute("cx")),y2=Number(toCircle.getAttribute("cy")),dx=x2-x1,dy=y2-y1,length=Math.max(1,Math.hypot(dx,dy)),startX=x1+dx/length*22,startY=y1+dy/length*22,endX=x2-dx/length*25,endY=y2-dy/length*25,midX=(startX+endX)/2,midY=(startY+endY)/2,from=connectionStart.getAttribute("data-node")||"node",to=endNode.getAttribute("data-node")||"node";const group=document.createElementNS("http://www.w3.org/2000/svg","g");group.setAttribute("data-edge",`${from}-${to}`);group.setAttribute("data-from",from);group.setAttribute("data-to",to);const line=document.createElementNS("http://www.w3.org/2000/svg","line");Object.entries({x1:startX,y1:startY,x2:endX,y2:endY,stroke:"#173f5f","stroke-width":"2"}).forEach(([key,val])=>line.setAttribute(key,String(val)));if(newEdgeDirected)line.setAttribute("marker-end","url(#arrowhead)");const cost=document.createElementNS("http://www.w3.org/2000/svg","text");Object.entries({x:midX,y:midY-7,"text-anchor":"middle","font-size":"15",fill:"#173f5f","paint-order":"stroke",stroke:"#fff","stroke-width":"4"}).forEach(([key,val])=>cost.setAttribute(key,String(val)));cost.textContent="";group.append(line,cost);selectedDiagram.querySelector("defs")?.after(group);setConnectionStart(null);setDiagramMode("select");selectSvgItem(group);sync()}
  function addSvgText(svg:SVGSVGElement,clientX:number,clientY:number){const point=svg.createSVGPoint();point.x=clientX;point.y=clientY;const matrix=svg.getScreenCTM();if(!matrix)return;const position=point.matrixTransform(matrix.inverse());rememberSvgChange();const text=document.createElementNS("http://www.w3.org/2000/svg","text");Object.entries({x:position.x,y:position.y,"font-size":"15","font-weight":"700",fill:"#173f5f","paint-order":"stroke",stroke:"#fff","stroke-width":"4"}).forEach(([key,value])=>text.setAttribute(key,String(value)));text.textContent="0";svg.append(text);setAddSvgTextMode(false);selectSvgItem(text);setSvgItemText("0");sync()}
  function handleDiagramClick(target:Element,svg:SVGSVGElement,clientX:number,clientY:number){if(selectedDiagram!==svg){clearSvgItemSelection();setSelectedDiagram(svg);svgHistory.current=[];svgFuture.current=[];setConnectionStart(null)}if(addSvgTextMode){addSvgText(svg,clientX,clientY);return}const node=target.closest<SVGGElement>("g[data-node]");if(diagramMode==="connect"&&node&&svg.contains(node)){addConnection(node);return}const edge=target.closest<SVGGElement>("g[data-edge]");const label=target.tagName.toLowerCase()==="text"&&!target.closest("g[data-node],g[data-edge]")?target:null;selectSvgItem(edge||node||label)}
  function logicalColumnIndex(cell:HTMLTableCellElement){return [...cell.parentElement!.cells].slice(0,cell.cellIndex).reduce((total,item)=>total+(item.colSpan||1),0)}
  function currentColumnWidth(cell:HTMLTableCellElement){const table=cell.closest("table");const index=logicalColumnIndex(cell);const col=table?.querySelector<HTMLTableColElement>(`colgroup col:nth-child(${index+1})`);return parseInt(col?.style.width||cell.style.width||"30",10)||30}
  function resizeColumn(percent:number){
    const cell=selectedCell;const table=cell?.closest("table");if(!cell||!table)return;
    const totalColumns=Math.max(...[...table.rows].map(row=>[...row.cells].reduce((total,item)=>total+(item.colSpan||1),0)),1);
    let colgroup=table.querySelector("colgroup");if(!colgroup){colgroup=document.createElement("colgroup");table.insertBefore(colgroup,table.firstChild)}
    while(colgroup.children.length<totalColumns)colgroup.append(document.createElement("col"));
    while(colgroup.children.length>totalColumns)colgroup.lastElementChild?.remove();
    const start=logicalColumnIndex(cell);const span=Math.max(1,cell.colSpan||1);const each=percent/span;
    for(let index=start;index<Math.min(totalColumns,start+span);index+=1)(colgroup.children[index] as HTMLTableColElement).style.width=`${each}%`;
    table.querySelectorAll<HTMLElement>("td,th").forEach(item=>{item.style.removeProperty("width");item.removeAttribute("width")});
    table.style.tableLayout="fixed";sync();
  }
  return <div className={`rich-field ${compact?"compact":""}`}><span>{label}</span>{category==="data-structure"&&label==="題幹"&&<span className="structure-type-picker"><b>題型分類</b><select value={structureType} onChange={event=>{const examType=event.currentTarget.value;setStructureType(examType);window.dispatchEvent(new CustomEvent("data-structure-question-type",{detail:{examType}}))}}><option value="">依原稿自動判斷</option><option value="mcq">選擇題</option><option value="short_answer">簡答題</option><option value="essay">申論題</option><option value="calculation">演算題</option></select><small>分類後仍在同一頁編輯</small></span>}<div className="rich-toolbar" role="toolbar" aria-label={`${label}格式工具`} onMouseDown={event=>{if((event.target as HTMLElement).closest("button")){rememberSelection();event.preventDefault()}}}>
    <button type="button" title="粗體" aria-pressed={formatState.bold} className={formatState.bold?"active":""} onClick={()=>command("bold")}><b>B</b></button><button type="button" title="斜體" aria-pressed={formatState.italic} className={formatState.italic?"active":""} onClick={()=>command("italic")}><i>I</i></button><button type="button" title="底線" aria-pressed={formatState.underline} className={formatState.underline?"active":""} onClick={()=>command("underline")}><u>U</u></button><button type="button" title="套用或移除會計數字雙底線" aria-label="雙底線／移除雙底線" onClick={doubleUnderline}><span style={{borderBottom:"3px double currentColor",paddingBottom:"1px"}}>U</span></button>
    <button type="button" title="上標" onClick={()=>command("superscript")}>x²</button><button type="button" title="下標" onClick={()=>command("subscript")}>x₂</button><button type="button" title="靠左對齊" aria-label="靠左對齊" aria-pressed={formatState.alignment==="left"} className={`rich-align-button ${formatState.alignment==="left"?"active":""}`} onClick={()=>command("justifyLeft")}>靠左</button><button type="button" title="置中對齊" aria-label="置中對齊" aria-pressed={formatState.alignment==="center"} className={`rich-align-button ${formatState.alignment==="center"?"active":""}`} onClick={()=>command("justifyCenter")}>置中</button><button type="button" title="靠右對齊" aria-label="靠右對齊" aria-pressed={formatState.alignment==="right"} className={`rich-align-button ${formatState.alignment==="right"?"active":""}`} onClick={()=>command("justifyRight")}>靠右</button><button type="button" title="插入項目符號（選取多段文字可轉換）" aria-pressed={formatState.unorderedList} className={formatState.unorderedList?"active":""} onClick={()=>command("insertUnorderedList")}>• 項目</button>
    <div className="font-color-tools" aria-label="字體顏色"><span>字色</span>{[["#174b47","黑"],["#c62828","紅"],["#1565c0","藍"],["#18815f","綠"]].map(([color,name])=><button key={color} type="button" title={`${name}色文字`} aria-label={`${name}色文字`} style={{backgroundColor:color}} onClick={()=>command("foreColor",color)}/>) }<label title="自選字體顏色"><input type="color" defaultValue="#174b47" onMouseDown={rememberSelection} onChange={event=>command("foreColor",event.currentTarget.value)}/></label></div><button type="button" title="新增表格" className={showTableGrid?"active":""} onClick={()=>{setShowTableGrid(!showTableGrid);setShowSymbols(false)}}>▦ 表格</button><button type="button" title="特殊符號" onClick={()=>{setShowSymbols(!showSymbols);setShowTableGrid(false)}}>Ω 符號</button><button type="button" title="插入圖片" onClick={()=>fileRef.current?.click()}>{uploading?"上傳中…":"▧ 圖片"}</button><button type="button" title="先點選圖片；有表格會轉成 HTML 表格，沒有表格會轉成可編輯文字" disabled={!selectedImage||convertingTable} onClick={()=>void convertSelectedImage()}>{convertingTable?"辨識中…":"圖片轉文字／表格"}</button>{category==="data-structure"&&<button type="button" title="先點選題幹中的資構圖片，再重建為可縮放 SVG" disabled={!selectedImage||convertingDiagram} onClick={()=>void convertSelectedDiagram()}>{convertingDiagram?"重建圖形中…":"圖片轉資構圖"}</button>}
    <button type="button" title="移除辨識內容或貼上內容的背景色" onClick={clearBackgroundColors}>清除底色</button><button type="button" title="復原" onClick={()=>command("undo")}>↶</button><button type="button" title="重做" onClick={()=>command("redo")}>↷</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value=""}}/>
  </div>{showTableGrid&&<div className="table-grid-picker" onMouseDown={event=>event.preventDefault()}><div className="table-grid-cells">{Array.from({length:64},(_,index)=>{const row=Math.floor(index/8)+1,col=index%8+1,active=row<=gridSize.rows&&col<=gridSize.cols;return <button type="button" aria-label={`${row} 列 ${col} 欄`} className={active?"active":""} key={index} onMouseEnter={()=>setGridSize({rows:row,cols:col})} onClick={()=>insertTable(row,col)}/>})}</div><b>{gridSize.rows} × {gridSize.cols}</b></div>}{showSymbols&&<div className="symbol-palette">{symbols.map(x=><button type="button" key={x} title={x==="°C"?"攝氏溫度格式":"插入特殊符號"} onClick={()=>command("insertText",x)}>{x}</button>)}</div>}
  {selectedCell&&<div className="table-context-toolbar" onMouseDown={event=>{if((event.target as HTMLElement).closest("button"))event.preventDefault()}}><span>表格編輯・已選 {selectedCells.length||1} 格</span><div className="cell-border-control"><button type="button" className={showBorderPicker?"active":""} onClick={()=>setShowBorderPicker(value=>!value)}>局部框線</button>{showBorderPicker&&<div className="cell-border-picker" aria-label="指定儲存格框線"><button type="button" className="top" title="切換所選儲存格上框線" onClick={()=>editTable("borderTop")}>上</button><button type="button" className="left" title="切換所選儲存格左框線" onClick={()=>editTable("borderLeft")}>左</button><span>{selectedCells.length||1} 格</span><button type="button" className="right" title="切換所選儲存格右框線" onClick={()=>editTable("borderRight")}>右</button><button type="button" className="bottom" title="切換所選儲存格下框線" onClick={()=>editTable("borderBottom")}>下</button><div className="cell-border-widths"><b>粗細</b>{([1,2,3] as const).map(width=><button type="button" key={width} className={borderWidth===width?"active":""} onClick={()=>changeBorderWidth(width)}><i style={{borderTopWidth:width}}/>{width===1?"細":width===2?"中":"粗"}</button>)}</div><div className="cell-border-presets"><button type="button" onClick={()=>editTable("borderInsetBottom")}>留白底線</button><button type="button" onClick={()=>editTable("borderOuter")}>外框</button><button type="button" onClick={()=>editTable("borderInner")}>內框</button><button type="button" onClick={()=>editTable("borderAll")}>全部</button><button type="button" onClick={()=>editTable("borderClear")}>清除</button></div><small>先選粗細，再套用框線；已顯示的框線可直接加粗</small></div>}</div><div className="table-align-group"><b>本格</b><button type="button" onClick={()=>editTable("alignLeft")}>左</button><button type="button" onClick={()=>editTable("alignCenter")}>中</button><button type="button" onClick={()=>editTable("alignRight")}>右</button></div><div className="table-align-group"><b>整欄</b><button type="button" onClick={()=>editTable("alignColumnLeft")}>左</button><button type="button" onClick={()=>editTable("alignColumnCenter")}>中</button><button type="button" onClick={()=>editTable("alignColumnRight")}>右</button></div><TableSizeControl key={`table-${selectedCell.closest("table")?.style.width||"100"}`} label="表格寬" min={40} max={100} value={parseInt(selectedCell.closest("table")?.style.width||"100",10)||100} onChange={resizeTable}/><TableSizeControl key={`column-${logicalColumnIndex(selectedCell)}-${currentColumnWidth(selectedCell)}`} label="本欄寬" min={10} max={70} value={currentColumnWidth(selectedCell)} onChange={resizeColumn}/><TablePixelControl key={`row-${selectedCell.parentElement?.style.height||"36"}`} label="列高" min={24} max={120} value={parseInt(selectedCell.parentElement?.style.height||"36",10)||36} onChange={resizeRows}/><button type="button" onClick={()=>editTable("toggleBorders")}>{selectedCell.closest("table")?.dataset.borders==="hidden"?"顯示全部":"隱藏全部"}</button><button type="button" onClick={()=>editTable("rowAbove")}>上方加列</button><button type="button" onClick={()=>editTable("rowBelow")}>下方加列</button><button type="button" onClick={()=>editTable("deleteRow")}>刪除列</button><button type="button" onClick={()=>editTable("colLeft")}>左側加欄</button><button type="button" onClick={()=>editTable("colRight")}>右側加欄</button><button type="button" onClick={()=>editTable("deleteCol")}>刪除欄</button><button type="button" disabled={!selectedCell.nextElementSibling} onClick={()=>editTable("mergeRight")}>向右合併</button><button type="button" disabled={selectedCell.colSpan<=1} onClick={()=>editTable("split")}>拆分</button></div>}
  {selectedDiagram&&<div className="diagram-context-toolbar"><span>圖形編輯</span><button type="button" className={diagramMode==="select"&&!addSvgTextMode?"active":""} onClick={()=>{setDiagramMode("select");setAddSvgTextMode(false);setConnectionStart(null)}}>選取</button><button type="button" className={diagramMode==="connect"&&!addSvgTextMode?"active":""} onClick={()=>{setDiagramMode("connect");setAddSvgTextMode(false);setConnectionStart(null);clearSvgItemSelection()}}>新增連線</button><button type="button" className={addSvgTextMode?"active":""} onClick={()=>{setAddSvgTextMode(true);setDiagramMode("select");setConnectionStart(null);clearSvgItemSelection()}}>新增數字／文字</button><label className="diagram-arrow-choice"><input type="checkbox" checked={newEdgeDirected} onChange={event=>setNewEdgeDirected(event.currentTarget.checked)}/>新線加箭頭</label><button type="button" disabled={!selectedSvgItem} onClick={deleteSvgItem}>刪除選取</button><button type="button" disabled={!svgHistory.current.length} onClick={undoSvg}>復原</button><button type="button" disabled={!svgFuture.current.length} onClick={redoSvg}>重做</button>{selectedSvgItem&&svgTextElement(selectedSvgItem)&&<label className="diagram-text-editor"><span>{selectedSvgItem.matches("g[data-edge]")?"權重":selectedSvgItem.matches("g[data-node]")?"節點":"文字／數字"}</span><input value={svgItemText} onChange={event=>setSvgItemText(event.currentTarget.value)} onKeyDown={event=>{if(event.key==="Enter")applySvgText()}}/><button type="button" onClick={applySvgText}>套用</button></label>}<TableSizeControl key={`diagram-${selectedDiagram.closest<HTMLElement>("figure")?.dataset.displayPercent||"70"}`} label="圖形寬" min={30} max={100} value={Number(selectedDiagram.closest<HTMLElement>("figure")?.dataset.displayPercent)||70} onChange={resizeDiagram}/><small>{addSvgTextMode?"請直接點圖上要放數字的位置":diagramMode==="connect"?(connectionStart?"請點第二個節點完成連線":"請先點起點，再點終點"):"點線條、節點或文字即可修改"}</small></div>}
  <div ref={ref} className={`rich-canvas ${diagramMode==="connect"||addSvgTextMode?"diagram-connect-mode":""}`} contentEditable suppressContentEditableWarning data-placeholder={`輸入${label}，也可以直接貼上 Word 內容或截圖`} onClick={event=>{rememberSelection();refreshFormatState();const target=event.target as HTMLElement;const cell=target.closest("td,th");if(cell&&ref.current?.contains(cell))selectTableCells(cell as HTMLTableCellElement,event);else{ref.current?.querySelectorAll("[data-table-editor-selected]").forEach(item=>item.removeAttribute("data-table-editor-selected"));setSelectedCell(null);setSelectedCells([])}const image=target.closest("img");setSelectedImage(image&&ref.current?.contains(image)?image as HTMLImageElement:null);const diagram=target.closest("svg");if(diagram&&ref.current?.contains(diagram))handleDiagramClick(target,diagram as SVGSVGElement,event.clientX,event.clientY);else{setSelectedDiagram(null);clearSvgItemSelection()}}} onFocus={()=>{rememberSelection();refreshFormatState()}} onSelect={()=>{rememberSelection();refreshFormatState()}} onKeyUp={()=>{rememberSelection();refreshFormatState()}} onMouseUp={()=>{rememberSelection();refreshFormatState()}} onInput={()=>{sync();refreshFormatState()}} onBlur={sync} onPaste={paste}/><small>可直接貼上 Word 格式與螢幕截圖；點選 SVG 可新增數字、修改文字、刪除錯線或重新連線。</small></div>
}

export function SourceWorkspace(){
  const [url,setUrl]=useState("");const [name,setName]=useState("");const [docx,setDocx]=useState("");
  async function open(file:File){setName(file.name);if(url)URL.revokeObjectURL(url);setDocx("");if(file.name.toLowerCase().endsWith(".docx")){const zip=unzipSync(new Uint8Array(await file.arrayBuffer()));const xml=strFromU8(zip["word/document.xml"]);const parsed=new DOMParser().parseFromString(xml,"application/xml");const blocks=[...parsed.getElementsByTagName("w:p")].map(p=>[...p.getElementsByTagName("w:t")].map(t=>t.textContent||"").join("")).filter(Boolean);setDocx(blocks.map(x=>`<p>${x.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!))}</p>`).join(""));setUrl("")}else setUrl(URL.createObjectURL(file))}
  return <aside className="source-workspace"><header><div><b>原稿對照</b><small>{name||"開啟 Word、PDF、HTML 或圖片"}</small></div><label className="source-open">開啟原稿<input hidden type="file" accept=".docx,.pdf,.html,.htm,image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void open(f)}}/></label></header>{docx?<article dangerouslySetInnerHTML={{__html:docx}}/>:url?<iframe src={url} title="題目來源原稿"/>:<div className="source-empty"><b>左右分割編輯</b><p>原稿只在本機瀏覽器開啟，不會另外上傳。選取 Word、PDF、HTML 或圖片後，可在右側逐題編輯。</p></div>}</aside>
}
