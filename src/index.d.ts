import type {ElementType} from 'react';
import type {Options, RenderNodes, Schema} from '@markdoc/markdoc';

export type MarkdocNextJsPageProps = {
  markdoc?: {
    content: RenderNodes;
    frontmatter: Record<string, any>;
    file: {
      path: string;
    };
  };
};

export type MarkdocNextJsConfig = Options & {readonly source: string};

export type MarkdocNextJsSchema<O extends Object = {}> = Schema<
  O & MarkdocNextJsConfig,
  ElementType
>;
