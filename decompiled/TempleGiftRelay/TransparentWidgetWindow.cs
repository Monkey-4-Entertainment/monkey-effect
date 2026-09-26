using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace TempleGiftRelay;

/// <summary>Real per-pixel-alpha desktop host; no chroma color or color-key filtering.</summary>
public sealed class TransparentWidgetWindow : Window
{
    private const double FrameEdge = 1;
    private const double CaptionHeight = 34;
    private static readonly HashSet<TransparentWidgetWindow> OpenWindows = new();
    private readonly WebView2CompositionControl _web;
    private readonly string _kind;
    private bool _closed;
    private string BoundsFile => Path.Combine(AppPaths.UserDataDir, $"native-widget-{_kind}-bounds.json");

    public static bool TryGetKind(string? url, out string kind)
    {
        kind = "";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "http" ||
            !uri.IsLoopback || uri.Port != 3847 || !string.IsNullOrEmpty(uri.UserInfo)) return false;
        if (uri.AbsolutePath == "/dragon-overlay.html") { kind = "dragon"; return true; }
        if (uri.AbsolutePath != "/jar-overlay.html") return false;
        var query = QueryHelpers.ParseQuery(uri.Query);
        var widget = query.TryGetValue("widget", out var value) ? value.ToString() : "";
        var style = query.TryGetValue("style", out var s) ? s.ToString() :
            query.TryGetValue("jarStyle", out var legacy) ? legacy.ToString() : "";
        kind = widget == "pirate" || (widget != "glass" &&
            (style == "duck-pirate" || style == "duck-cruise" || style == "monkey-pirate")) ? "pirate" : "glass";
        return true;
    }

    public static async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (!TryGetKind(e.Uri, out string kind)) return;
        using var deferral = e.GetDeferral();
        e.Handled = true;
        TransparentWidgetWindow? popup = null;
        try
        {
            popup = new TransparentWidgetWindow(kind);
            System.Windows.Forms.Integration.ElementHost.EnableModelessKeyboardInterop(popup);
            OpenWindows.Add(popup);
            popup.Show();
            // Sharing the opener's environment preserves the widget event channel,
            // localStorage, saved ranks and gift state. Let the popup request navigate.
            await popup._web.EnsureCoreWebView2Async(await WebViewEnv.GetAsync());
            if (popup._closed) return;
            var core = popup._web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.WindowCloseRequested += (_, _) => popup.Close();
            core.WebMessageReceived += (_, message) =>
            {
                try
                {
                    if (message.TryGetWebMessageAsString() == "drag" && Mouse.LeftButton == MouseButtonState.Pressed)
                        popup.DragMove();
                }
                catch { }
            };
            e.NewWindow = core;
            popup.Activate();
        }
        catch (Exception ex)
        {
            popup?.Close();
            AppPaths.Log("Transparent widget failed: " + ex);
            System.Windows.Forms.MessageBox.Show("เปิดหน้าต่าง Overlay โปร่งใสไม่สำเร็จ:\n" + ex.Message,
                "Monkeyeffect", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
        }
        // Disposing this deferral completes it. Calling Complete as well causes
        // E_ILLEGAL_METHOD_CALL on subsequent popups in the current WebView2 SDK.
    }

    private TransparentWidgetWindow(string kind)
    {
        _kind = kind;
        Title = "Monkeyeffect · " + (kind == "dragon" ? "มังกร" : kind == "pirate" ? "เรือโจรสลัด" : "โหลแก้ว") + " · Transparent Overlay";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = true;
        Topmost = false;
        UseLayoutRounding = true;
        SnapsToDevicePixels = true;
        WindowStartupLocation = WindowStartupLocation.Manual;
        SetViewportWidth(432);
        RestoreSavedBounds();
        _web = new WebView2CompositionControl
        {
            DefaultBackgroundColor = System.Drawing.Color.Transparent,
            Background = Brushes.Transparent,
            Focusable = true
        };
        // Only the frame and caption are painted. The viewport remains real alpha.
        // A normal WPF WindowStyle cannot be combined with AllowsTransparency.
        var layout = new Grid();
        layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(CaptionHeight) });
        layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var caption = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(23, 32, 48)),
            CornerRadius = new CornerRadius(7, 7, 0, 0)
        };
        var captionContent = new DockPanel { LastChildFill = true };
        var closeButton = new Button
        {
            Content = "×", Width = 36, FontSize = 21, Foreground = Brushes.White,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            ToolTip = "ปิด Overlay", Focusable = false
        };
        System.Windows.Automation.AutomationProperties.SetName(closeButton, "ปิด Overlay");
        System.Windows.Automation.AutomationProperties.SetAutomationId(closeButton, "CloseOverlay");
        closeButton.Click += (_, _) => Close();
        DockPanel.SetDock(closeButton, Dock.Right); captionContent.Children.Add(closeButton);
        var minimizeButton = new Button
        {
            Content = "−", Width = 34, FontSize = 19, Foreground = Brushes.White,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            ToolTip = "ย่อหน้าต่าง", Focusable = false
        };
        System.Windows.Automation.AutomationProperties.SetName(minimizeButton, "ย่อหน้าต่าง Overlay");
        System.Windows.Automation.AutomationProperties.SetAutomationId(minimizeButton, "MinimizeOverlay");
        minimizeButton.Click += (_, _) => WindowState = WindowState.Minimized;
        DockPanel.SetDock(minimizeButton, Dock.Right); captionContent.Children.Add(minimizeButton);
        var captionText = new TextBlock
        {
            Text = (_kind == "dragon" ? "มังกร" : _kind == "pirate" ? "เรือโจรสลัด" : "โหลแก้ว") + "  ·  Overlay โปร่งใส",
            FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White,
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 8, 0),
            TextTrimming = TextTrimming.CharacterEllipsis, ToolTip = "ลากแถบนี้เพื่อย้ายหน้าต่าง · คลิกขวาเพื่อปรับขนาด"
        };
        captionContent.Children.Add(captionText); caption.Child = captionContent;
        caption.MouseLeftButtonDown += (_, e) =>
        {
            // Button clicks are already handled; ordinary title dragging is native.
            if (e.Handled) return;
            try { DragMove(); } catch { }
        };
        layout.Children.Add(caption);
        Grid.SetRow(_web, 1); layout.Children.Add(_web);
        Content = new Border
        {
            BorderBrush = new SolidColorBrush(Color.FromRgb(92, 111, 142)),
            BorderThickness = new Thickness(FrameEdge), CornerRadius = new CornerRadius(8),
            Background = Brushes.Transparent, Child = layout
        };
        PreviewMouseLeftButtonDown += (_, e) =>
        {
            if ((Keyboard.Modifiers & ModifierKeys.Alt) == 0) return;
            e.Handled = true;
            try { DragMove(); } catch { }
        };
        PreviewMouseRightButtonUp += (_, e) =>
        {
            e.Handled = true;
            var menu = new ContextMenu();
            menu.Items.Add(new MenuItem { Header = "ลากแถบชื่อเพื่อย้ายหน้าต่าง", IsEnabled = false });
            foreach (int width in new[] { 270, 360, 432, 540, 720 })
            {
                var item = new MenuItem { Header = $"ขนาด {width} × {width * 16 / 9}" };
                item.Click += (_, _) => { SetViewportWidth(width); FitOnScreen(); SaveBounds(); };
                menu.Items.Add(item);
            }
            var topmost = new MenuItem { Header = "แสดงอยู่ด้านบน", IsCheckable = true, IsChecked = Topmost };
            topmost.Click += (_, _) => Topmost = topmost.IsChecked;
            menu.Items.Add(topmost);
            var close = new MenuItem { Header = "ปิด Overlay" }; close.Click += (_, _) => Close(); menu.Items.Add(close);
            menu.IsOpen = true;
        };
        LocationChanged += (_, _) => { if (IsLoaded) SaveBounds(); };
        Closed += (_, _) => { _closed = true; SaveBounds(); OpenWindows.Remove(this); _web.Dispose(); };
    }

    private void FitOnScreen()
    {
        var area = SystemParameters.WorkArea;
        if (Height > area.Height) SetViewportWidth((area.Height - CaptionHeight - FrameEdge * 2) * 9 / 16);
        Left = Math.Clamp(Left, area.Left, Math.Max(area.Left, area.Right - Width));
        Top = Math.Clamp(Top, area.Top, Math.Max(area.Top, area.Bottom - Height));
    }

    private void RestoreSavedBounds()
    {
        Left = SystemParameters.WorkArea.Right - Width - 24; Top = SystemParameters.WorkArea.Top + 24;
        try
        {
            if (File.Exists(BoundsFile))
            {
                var p = JsonSerializer.Deserialize<SavedBounds>(File.ReadAllText(BoundsFile));
                if (p != null && double.IsFinite(p.Left) && double.IsFinite(p.Top) && p.Width >= 216 && p.Width <= 1440)
                { Left = p.Left; Top = p.Top; SetViewportWidth(p.Width); }
            }
        }
        catch { }
        FitOnScreen();
    }

    private void SaveBounds()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.UserDataDir);
            File.WriteAllText(BoundsFile, JsonSerializer.Serialize(new SavedBounds { Left = Left, Top = Top, Width = Width - FrameEdge * 2 }));
        }
        catch { }
    }

    private void SetViewportWidth(double width)
    {
        Width = width + FrameEdge * 2;
        Height = width * 16 / 9 + CaptionHeight + FrameEdge * 2;
    }

    public static void CloseAll() { foreach (var popup in OpenWindows.ToArray()) popup.Close(); }
    private sealed class SavedBounds { public double Left { get; set; } public double Top { get; set; } public double Width { get; set; } }
}
