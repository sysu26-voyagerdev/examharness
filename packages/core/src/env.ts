/**
 * 展开 `${VAR}` 引用。**密钥只从环境变量取**，配置文件里不写明文。
 * 找不到就返回空串——调用方据此判定"这项能力没配好"，而不是拿空密钥去请求。
 */
export function expandEnv(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => env[key] ?? '')
}
