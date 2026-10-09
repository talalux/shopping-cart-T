using System.Globalization;
using ClosedXML.Excel;

namespace ShopCart.Api.Services;

/// <summary>One data row as read from the sheet. Row = real Excel row number (header = 1). Qty: double (number cell) or string; Exp: DateTime (date cell) or string.</summary>
public record RawRow(int Row, string? Code, object? Qty, object? Exp, string FormulaCols = "");

public static class StockImportFile
{
    public const int MaxBytes = 2 * 1024 * 1024;
    public const int MaxRows = 1000;
    public const string OnlyXlsxMessage = "รองรับเฉพาะไฟล์ .xlsx — ดาวน์โหลด template ได้ที่ปุ่มด้านบน";
    public const string SheetName = "นำเข้า";

    /// <summary>Returns rows (blank rows skipped) or an error message for a 400.</summary>
    public static (List<RawRow>? Rows, string? Error) Read(byte[] bytes)
    {
        try
        {
            using var wb = new XLWorkbook(new MemoryStream(bytes));
            var ws = wb.Worksheets.FirstOrDefault(w => w.Name == SheetName);
            if (ws is null) return (null, $"ไม่พบชีต '{SheetName}' — ใช้ template จากปุ่มดาวน์โหลด");
            var last = ws.LastRowUsed()?.RowNumber() ?? 1;
            if (last - 1 > MaxRows * 20) return (null, "ไฟล์มีแถวมากเกินไป (ลบแถวว่างท้ายไฟล์ออก)"); // pathological sparse sheet
            var rows = new List<RawRow>();
            for (var r = 2; r <= last; r++)
            {
                var formula = "";
                var code = Text(ws.Cell(r, 1), 'A', ref formula);
                var qty = Value(ws.Cell(r, 2), 'B', ref formula);
                var exp = Value(ws.Cell(r, 3), 'C', ref formula);
                if (code is null && qty is null && exp is null && formula.Length == 0) continue; // fully blank row
                rows.Add(new RawRow(r, code, qty, exp, formula));
                // the cap counts rows that hold data, not blank gaps
                if (rows.Count > MaxRows) return (null, $"ไฟล์มีเกิน {MaxRows:N0} แถวข้อมูล");
            }
            if (rows.Count == 0) return (null, "ไฟล์ไม่มีข้อมูล");
            return (rows, null);
        }
        catch (Exception)
        {
            return (null, "เปิดไฟล์ไม่ได้ — ไฟล์เสียหรือไม่ใช่ .xlsx จริง " + OnlyXlsxMessage);
        }
    }

    public static string FormulaMessage(string col) => $"ช่อง{col}เป็นสูตรที่ยังไม่ได้คำนวณ — เปิดไฟล์ใน Excel แล้วบันทึกอีกครั้ง";

    // a formula whose result was never stored in the file (file made by a library, not saved by Excel)
    static bool UncachedFormula(IXLCell c) => c.HasFormula && c.CachedValue.IsBlank;

    static string? Text(IXLCell c, char col, ref string formula)
    {
        if (UncachedFormula(c)) { formula += col; return null; }
        if (c.IsEmpty()) return null;
        var s = c.GetString().Trim();
        return s.Length == 0 ? null : s;
    }

    static object? Value(IXLCell c, char col, ref string formula)
    {
        if (UncachedFormula(c)) { formula += col; return null; }
        if (c.IsEmpty()) return null;
        switch (c.DataType)
        {
            case XLDataType.DateTime: return c.GetDateTime();
            case XLDataType.Number: return c.GetDouble();
            default:
                var s = c.GetString().Trim();
                return s.Length == 0 ? null : s;
        }
    }

    public static bool TryQty(object? raw, out int qty)
    {
        qty = 0;
        switch (raw)
        {
            case double d:
                if (d != Math.Floor(d) || d <= 0 || d > 1_000_000) return false;
                qty = (int)d; return true;
            case string s:
                if (!int.TryParse(s, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var i) || i <= 0 || i > 1_000_000) return false;
                qty = i; return true;
            default: return false;
        }
    }

    public static bool TryExp(object? raw, out DateOnly exp)
    {
        exp = default;
        switch (raw)
        {
            case DateTime dt: exp = DateOnly.FromDateTime(dt); return true;
            case string s:
                return DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out exp);
            default: return false; // plain number = ambiguous
        }
    }

    public static string Display(object? raw) => raw switch
    {
        null => "",
        DateTime dt => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        double d => d.ToString(CultureInfo.InvariantCulture),
        _ => raw.ToString() ?? ""
    };
}
