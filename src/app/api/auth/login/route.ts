import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "solucoes-financeiras-super-secret-key-2026"
);

export async function POST(request: Request) {
  try {
    const { email, password, rememberMe, biometricToken } = await request.json();

    let user = null;

    if (biometricToken) {
      // Face ID / biometria: o aparelho guarda um token assinado, emitido num login anterior com senha.
      try {
        const { payload } = await jwtVerify(String(biometricToken), JWT_SECRET);
        if (payload.purpose !== "biometric_auth" || !payload.sub) {
          return NextResponse.json({ error: "Credencial biométrica inválida ou expirada." }, { status: 401 });
        }
        user = await prisma.perfil.findUnique({ where: { id: String(payload.sub) } });
      } catch {
        return NextResponse.json(
          { error: "Sessão biométrica expirada. Entre com sua senha para reativar o Face ID." },
          { status: 401 }
        );
      }

      if (!user) {
        return NextResponse.json({ error: "Usuário não encontrado." }, { status: 401 });
      }
    } else {
      if (!email || !password) {
        return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 });
      }

      const emailLimpo = String(email).trim();

      // Ignora maiúsculas/minúsculas (teclado do celular costuma capitalizar a 1ª letra)
      user = await prisma.perfil.findFirst({
        where: { email: { equals: emailLimpo, mode: "insensitive" } },
      });

      if (!user) {
        // Se o banco estiver totalmente sem usuários, cria o primeiro usuário automaticamente
        const count = await prisma.perfil.count().catch(() => 0);
        if (count === 0) {
          const hashedPassword = await bcrypt.hash(password, 10);
          user = await prisma.perfil.create({
            data: {
              nome: "Administrador",
              email: emailLimpo,
              senha: hashedPassword,
            },
          });
        } else {
          return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
        }
      }

      const isValid = await bcrypt.compare(password, user.senha);

      if (!isValid) {
        return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
      }
    }

    // Tempo de expiração: 30 dias se "Lembrar-me" estiver marcado, senão 24h
    const tokenExp = rememberMe ? "30d" : "24h";
    const cookieMaxAge = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24; // 30 dias ou 24 horas

    // Gerar token
    const token = await new SignJWT({ sub: user.id, email: user.email, nome: user.nome })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(tokenExp)
      .sign(JWT_SECRET);

    // Token do Face ID deste aparelho (renovado a cada login)
    const issuedBiometricToken = await new SignJWT({
      sub: user.id,
      email: user.email,
      nome: user.nome,
      purpose: "biometric_auth",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("90d")
      .sign(JWT_SECRET);

    const response = NextResponse.json({
      success: true,
      biometricToken: issuedBiometricToken,
      user: { id: user.id, name: user.nome, email: user.email },
    });

    // Set HTTP-only cookie
    response.cookies.set({
      name: "sol_auth_token",
      value: token,
      httpOnly: true,
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: cookieMaxAge,
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}