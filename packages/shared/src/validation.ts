export function assertEmail(email: string): void {
  const normalized = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email format");
  }
}

export function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
}

export function assertE164(phone: string): void {
  const normalized = phone.trim();
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) {
    throw new Error("Phone must be in E.164 format");
  }
}
