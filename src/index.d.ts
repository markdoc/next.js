import type {ElementType} from 'react';
import type {Config, RenderableTreeNodes, Schema} from '@markdoc/markdoc';

export type MarkdocNextJsPageProps = {
  markdoc?: {
    content: RenderableTreeNodes;
    frontmatter: Record<string, any>;
    file: {
      path: string;
    };
  };
};

export type MarkdocNextJsConfig = Config & {readonly source: string};

export type MarkdocNextJsSchema<O extends Object = {}> = Schema<
  O & MarkdocNextJsConfig,
  ElementType
>;
