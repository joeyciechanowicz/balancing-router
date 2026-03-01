export interface StaticSegmentAst {
  kind: 'static';
  value: string;
}

export interface GroupSegmentAst {
  kind: 'group';
  alternatives: string[];
}

export interface ParamSegmentAst {
  kind: 'param';
  name: string;
  pattern?: string;
  optional: boolean;
}

export interface WildcardSegmentAst {
  kind: 'wildcard';
  name: string;
}

export type SegmentAst = StaticSegmentAst | GroupSegmentAst | ParamSegmentAst | WildcardSegmentAst;

export interface RouteAst {
  original: string;
  normalized: string;
  segments: SegmentAst[];
}

export interface StaticSegmentIr {
  kind: 'static';
  value: string;
}

export interface ParamSegmentIr {
  kind: 'param';
  name: string;
  pattern?: string;
}

export interface WildcardSegmentIr {
  kind: 'wildcard';
  name: string;
}

export type SegmentIr = StaticSegmentIr | ParamSegmentIr | WildcardSegmentIr;

export interface RouteIrVariant {
  segments: SegmentIr[];
}

export interface RouteIr {
  source: string;
  variants: RouteIrVariant[];
}

