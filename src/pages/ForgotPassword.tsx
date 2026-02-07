import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * ForgotPassword agora redireciona para a página de autenticação.
 * O Clerk gerencia a recuperação de senha internamente através do componente SignIn.
 */
export function ForgotPassword() {
  const navigate = useNavigate();

  useEffect(() => {
    // O Clerk gerencia recuperação de senha internamente
    navigate('/auth', { replace: true });
  }, [navigate]);

  return null;
}
