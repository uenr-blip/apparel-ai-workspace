export const SEARCH_KINDS = ["style","project","material","order","customer","factory","supplier"] as const;
export type SearchKind = typeof SEARCH_KINDS[number];
export const SEARCH_LABELS:Record<SearchKind,string> = {style:"款式",project:"开发款式",material:"材料",order:"生产订单",customer:"客户",factory:"工厂",supplier:"供应商"};
export type SearchItem = {id:string;kind:SearchKind;code:string;name:string;detail:string;href:string};
export type SearchResult = {query:string;items:SearchItem[];counts:Partial<Record<SearchKind,number>>;total:number;page:number;pageSize:number;pageCount:number};
export const searchQuery = (value:unknown) => typeof value === "string" ? value.trim().slice(0,100) : "";
export function searchHref(q:string,kind?:SearchKind,page=1) {const p=new URLSearchParams({q});if(kind)p.set("kind",kind);if(page>1)p.set("page",String(page));return `/search?${p}`;}
