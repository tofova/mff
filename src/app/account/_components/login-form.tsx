'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { login } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { PasswordInput } from './password-input';
import { track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Logging In...' : 'Log In'}
    </Button>
  );
}

export default function LoginForm() {
  const initialState = { message: '', success: false };
  const [state, dispatch] = useActionState(login, initialState);
  const { toast } = useToast();

  useEffect(() => {
    if (state.message && !state.success) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: state.message,
      });
      track(AnalyticsEvents.loginFailed, { reason: state.message });
    }
     if (state.message && state.success) {
      toast({
        title: 'Success',
        description: state.message,
      });
      track(AnalyticsEvents.loginSucceeded);
    }
  }, [state, toast]);

  return (
    <form action={dispatch}>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username-login">Username</Label>
          <Input id="username-login" name="username" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password-login">Password</Label>
          <PasswordInput id="password-login" name="password" required />
        </div>
      </CardContent>
      <CardFooter>
        <SubmitButton />
      </CardFooter>
    </form>
  );
}
