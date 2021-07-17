import { Show, createMemo, on, createRoot, mergeProps, splitProps } from "solid-js";
import type { Component, JSX } from "solid-js";
import { isServer } from "solid-js/web";
import {
  RouteContext,
  RouterContext,
  createRouteState,
  createRouterState,
  useRoute,
  useRouter,
  createRoutes,
  getMatches,
  useResolvedPath,
  useLocation,
  useNavigate,
  useHref
} from "./routing";
import type {
  Location,
  Navigate,
  RouteDataFunc,
  RouteDefinition,
  RouterIntegration,
  RouteState,
  RouteUpdateSignal
} from "./types";
import { pathIntegration, staticIntegration } from "./integration";

export type RouterProps = {
  base?: string;
  children: JSX.Element;
  context?: object;
} & (
  | {
      url?: never;
      source?: RouterIntegration | RouteUpdateSignal;
    }
  | {
      source?: never;
      url: string;
    }
);

export const Router = (props: RouterProps) => {
  const { source, url, base, context } = props;
  const integration =
    source || (isServer ? staticIntegration({ value: url || "" }) : pathIntegration());
  const routerState = createRouterState(integration, base, context);

  return <RouterContext.Provider value={routerState}>{props.children}</RouterContext.Provider>;
};

export interface RoutesProps {
  base?: string;
  fallback?: JSX.Element;
  children: JSX.Element;
}

export const Routes = (props: RoutesProps) => {
  const router = useRouter();
  const parentRoute = useRoute();

  const basePath = useResolvedPath(() => props.base || "");
  const routes = createMemo(() =>
    createRoutes(props.children as RouteDefinition | RouteDefinition[], basePath() || "", Outlet)
  );
  const matches = createMemo(() => getMatches(routes(), router.location.pathname));

  if (router.outContext) {
    router.outContext.matches.push(
      matches().map(({ route, path, params }) => ({
        originalPath: route.originalPath,
        pattern: route.pattern,
        path,
        params
      }))
    );
  }

  const disposers: (() => void)[] = [];
  let root: RouteState | undefined;

  const routeStates = createMemo<RouteState[]>(
    on(matches, (nextMatches, prevMatches, prev) => {
      let equal = prevMatches && nextMatches.length === prevMatches.length;
      const next: RouteState[] = [];
      for (let i = 0, len = nextMatches.length; i < len; i++) {
        const prevMatch = prevMatches?.[i];
        const nextMatch = nextMatches[i];

        if (prev && prevMatch && nextMatch.route.pattern === prevMatch.route.pattern) {
          next[i] = prev[i];
        } else {
          equal = false;
          if (disposers[i]) {
            disposers[i]();
          }

          createRoot(dispose => {
            disposers[i] = dispose;
            next[i] = createRouteState(
              router,
              next[i - 1] || parentRoute,
              () => routeStates()[i + 1],
              () => matches()[i]
            );
          });
        }
      }

      disposers.splice(nextMatches.length).forEach(dispose => dispose());

      if (prev && equal) {
        return prev;
      }
      root = next[0];
      return next;
    })
  );

  return (
    <Show when={routeStates() && root} fallback={props.fallback}>
      {route => <RouteContext.Provider value={route}>{route.outlet()}</RouteContext.Provider>}
    </Show>
  );
};

export const useRoutes = (routes: RouteDefinition | RouteDefinition[], base?: string) => {
  return (props: { fallback?: JSX.Element }) => (
    <Routes base={base} fallback={props.fallback}>
      {routes as any}
    </Routes>
  );
};

type RouteProps = {
  path: string;
  children?: JSX.Element;
  data?: RouteDataFunc;
} & (
  | {
      element?: never;
      component: Component;
    }
  | {
      component?: never;
      element?: JSX.Element;
      preload?: () => void;
    }
);

export const Route = (props: RouteProps) => props as JSX.Element;

export const Outlet = () => {
  const route = useRoute();
  return (
    <Show when={route.child}>
      {child => <RouteContext.Provider value={child}>{child.outlet()}</RouteContext.Provider>}
    </Show>
  );
};

interface LinkBaseProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string | undefined;
}

function LinkBase(props: LinkBaseProps) {
  const [, rest] = splitProps(props, ["children", "to", "href", "onClick"]);
  const navigate = useNavigate();
  const href = useHref(() => props.to);

  const handleClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = evt => {
    const { onClick, to, target } = props;
    if (typeof onClick === "function") {
      onClick(evt);
    } else if (onClick) {
      onClick[0](onClick[1], evt);
    }
    if (
      to !== undefined &&
      !evt.defaultPrevented &&
      evt.button === 0 &&
      (!target || target === "_self") &&
      !(evt.metaKey || evt.altKey || evt.ctrlKey || evt.shiftKey)
    ) {
      evt.preventDefault();
      navigate(to, { resolve: false });
    }
  };

  return (
    <a {...rest} href={href() ?? props.href} onClick={handleClick}>
      {props.children}
    </a>
  );
}

export interface LinkProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export function Link(props: LinkProps) {
  const to = useResolvedPath(() => props.href);
  return <LinkBase {...props} to={to()} />;
}

export interface NavLinkProps extends LinkProps {
  activeClass?: string;
  end?: boolean;
}

export function NavLink(props: NavLinkProps) {
  props = mergeProps({ activeClass: "is-active" }, props);
  const [, rest] = splitProps(props, ["activeClass", "end"]);
  const location = useLocation();
  const to = useResolvedPath(() => props.href);
  const isActive = createMemo(() => {
    const to_ = to();
    if (to_ === undefined) {
      return false;
    }
    const path = to_.split(/[?#]/, 1)[0].toLowerCase();
    const loc = location.pathname.toLowerCase();
    return props.end ? path === loc : loc.startsWith(path);
  });

  return (
    <LinkBase
      {...rest}
      to={to()}
      classList={{ [props.activeClass!]: isActive() }}
      aria-current={isActive() ? "page" : undefined}
    />
  );
}

export interface RedirectProps {
  href: ((args: { navigate: Navigate; location: Location }) => string) | string;
}

export function Redirect(props: RedirectProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { href } = props;
  const path = typeof href === "function" ? href({ navigate, location }) : href;
  navigate(path, { replace: true });
  return null;
}