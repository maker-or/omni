import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  memo,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ShikiCodeBlock } from "@/components/ui/shiki-code-block";

type WithNode<T> = T & ExtraProps;
type TableRowElement = ReactElement<{ index?: number }>;

type MarkdownRendererProps = {
  children: string;
  className?: string;
  components?: Components;
  isStreaming?: boolean;
};

const MarkdownRenderContext = createContext({ isStreaming: false });

function omitNode<T extends { node?: unknown }>(props: T) {
  const { node, ...rest } = props;
  void node;
  return rest;
}

const MarkdownTable = memo(
  (props: WithNode<ComponentPropsWithoutRef<"table">>) => {
    const { className, children, ...rest } = omitNode(props);

    return (
      <div className="min-w-0 max-w-full overflow-hidden" data-markdown="table-wrapper">
        <Table className={cn("table-fixed", className)} data-markdown="table" {...rest}>
          {children}
        </Table>
      </div>
    );
  },
);

MarkdownTable.displayName = "MarkdownTable";

const MarkdownTableHeader = memo(
  (props: WithNode<ComponentPropsWithoutRef<"thead">>) => {
    const { className, ...rest } = omitNode(props);
    return (
      <TableHeader className={className} data-markdown="table-header" {...rest} />
    );
  },
);

MarkdownTableHeader.displayName = "MarkdownTableHeader";

function indexBodyRows(children: ReactNode): ReactNode {
  let rowIndex = 0;

  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;

    const indexedChild = cloneElement(child as TableRowElement, {
      index: rowIndex,
    });
    rowIndex += 1;
    return indexedChild;
  });
}

const MarkdownTableBody = memo(
  (props: WithNode<ComponentPropsWithoutRef<"tbody">>) => {
    const { children, className, ...rest } = omitNode(props);
    return (
      <TableBody className={className} data-markdown="table-body" {...rest}>
        {indexBodyRows(children)}
      </TableBody>
    );
  },
);

MarkdownTableBody.displayName = "MarkdownTableBody";

const MarkdownTableRow = memo(
  (props: WithNode<ComponentPropsWithoutRef<"tr"> & { index?: number }>) => {
    const { className, index, ...rest } = omitNode(props);
    return (
      <TableRow
        className={className}
        data-markdown="table-row"
        index={index}
        {...rest}
      />
    );
  },
);

MarkdownTableRow.displayName = "MarkdownTableRow";

const MarkdownTableHead = memo(
  (props: WithNode<ComponentPropsWithoutRef<"th">>) => {
    const { className, ...rest } = omitNode(props);
    return (
      <TableHead
        className={cn("whitespace-normal break-words align-top [overflow-wrap:anywhere]", className)}
        data-markdown="table-header-cell"
        {...rest}
      />
    );
  },
);

MarkdownTableHead.displayName = "MarkdownTableHead";

const MarkdownTableCell = memo(
  (props: WithNode<ComponentPropsWithoutRef<"td">>) => {
    const { className, ...rest } = omitNode(props);
    return (
      <TableCell
        className={cn("whitespace-normal break-words align-top [overflow-wrap:anywhere]", className)}
        data-markdown="table-cell"
        {...rest}
      />
    );
  },
);

MarkdownTableCell.displayName = "MarkdownTableCell";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSanitize];

function MarkdownCode({
  className,
  children,
  ...props
}: WithNode<ComponentPropsWithoutRef<"code">>) {
  const rest = omitNode(props);
  const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
  const code = String(children).replace(/\n$/, "");
  const isBlock = language || String(children).includes("\n");
  const { isStreaming } = useContext(MarkdownRenderContext);

  if (isBlock) {
    return (
      <ShikiCodeBlock
        code={code}
        isStreaming={isStreaming}
        language={language ?? "text"}
      />
    );
  }

  return (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm break-words [overflow-wrap:anywhere]", className)}
      {...rest}
    >
      {children}
    </code>
  );
}

const defaultMarkdownComponents = {
  table: MarkdownTable,
  thead: MarkdownTableHeader,
  tbody: MarkdownTableBody,
  tr: MarkdownTableRow,
  th: MarkdownTableHead,
  td: MarkdownTableCell,
  p: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"p">>) => {
    const rest = omitNode(props);
    return <p className={cn("leading-6 break-words [overflow-wrap:anywhere]", className)} {...rest} />;
  },
  ul: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"ul">>) => {
    const rest = omitNode(props);
    return <ul className={cn("list-inside list-disc", className)} {...rest} />;
  },
  ol: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"ol">>) => {
    const rest = omitNode(props);
    return <ol className={cn("list-inside list-decimal", className)} {...rest} />;
  },
  li: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"li">>) => {
    const rest = omitNode(props);
    return <li className={cn("py-1 break-words [overflow-wrap:anywhere]", className)} {...rest} />;
  },
  blockquote: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"blockquote">>) => {
    const rest = omitNode(props);
    return (
      <blockquote
        className={cn(
          "border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic",
          className,
        )}
        {...rest}
      />
    );
  },
  code: MarkdownCode,
  pre: ({ children }: WithNode<ComponentPropsWithoutRef<"pre">>) => <>{children}</>,
  a: ({ className, ...props }: WithNode<ComponentPropsWithoutRef<"a">>) => {
    const rest = omitNode(props);
    return (
      <a
        className={cn("font-medium text-primary underline break-words [overflow-wrap:anywhere]", className)}
        rel="noreferrer"
        target="_blank"
        {...rest}
      />
    );
  },
} satisfies Components;

function MarkdownRendererBase({
  children,
  className,
  components,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full space-y-3 overflow-hidden whitespace-normal break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <MarkdownRenderContext.Provider value={{ isStreaming }}>
        <ReactMarkdown
          components={components ? { ...defaultMarkdownComponents, ...components } : defaultMarkdownComponents}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
        >
          {children}
        </ReactMarkdown>
      </MarkdownRenderContext.Provider>
    </div>
  );
}

export const MarkdownRenderer = memo(
  MarkdownRendererBase,
  (prev, next) =>
    prev.children === next.children &&
    prev.className === next.className &&
    prev.components === next.components &&
    prev.isStreaming === next.isStreaming,
);
