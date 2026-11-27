import jwt from "jsonwebtoken";

export type AccessPayload = { sub: string; roles: string[]; iat?: number };

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export const signAccessToken = (p: AccessPayload) =>
  jwt.sign({ roles: p.roles }, secret(), { subject: p.sub, expiresIn: "15m" });

export const verifyAccessToken = (token: string): AccessPayload => {
  const d = jwt.verify(token, secret()) as jwt.JwtPayload; // checks signature + exp
  return { sub: d.sub as string, roles: d.roles ?? [], iat: d.iat };
};
