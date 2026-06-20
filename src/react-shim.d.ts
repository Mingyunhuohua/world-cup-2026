declare namespace JSX {
  interface IntrinsicAttributes {
    key?: any;
  }

  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare module "react" {
  export type ReactNode = any;
  export type MutableRefObject<T> = {
    current: T;
  };

  export class Component<P = {}, S = {}> {
    constructor(props: P);
    props: P;
    state: S;
    setState(state: Partial<S> | ((previous: S) => Partial<S>)): void;
  }

  export const StrictMode: any;

  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[]
  ): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initialValue: T): MutableRefObject<T>;
  export function useState<T>(
    initialValue: T
  ): [T, (value: T | ((previous: T) => T)) => void];
  export function useTransition(): [boolean, (callback: () => void) => void];
}

declare module "react-dom/client" {
  export function createRoot(element: Element): {
    render(children: unknown): void;
  };
}

declare module "react/jsx-runtime" {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}
