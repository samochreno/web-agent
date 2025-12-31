<?php

use App\Http\Controllers\ChatController;
use App\Http\Controllers\ChatKitSessionController;
use App\Http\Controllers\ChatKitToolController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\GoogleAuthController;
use Illuminate\Support\Facades\Route;

Route::get('/', [ChatController::class, 'index'])->name('chat.index');
Route::get('/settings', [ChatController::class, 'settings'])->name('chat.settings');
Route::post('/chat/message', [ChatController::class, 'store'])->name('chat.message');
Route::post('/chat/reset', [ChatController::class, 'reset'])->name('chat.reset');
Route::post('/chatkit/session', [ChatKitSessionController::class, 'store'])->name('chatkit.session');
Route::post('/chatkit/tool', [ChatKitToolController::class, 'store'])->name('chatkit.tool');
Route::get('/calendars', [CalendarController::class, 'index'])->name('calendars.index');
Route::post('/calendars/visible', [CalendarController::class, 'update'])->name('calendars.visible');

Route::get('/auth/google/redirect', [GoogleAuthController::class, 'redirect'])->name('google.redirect');
Route::get('/auth/google/callback', [GoogleAuthController::class, 'callback'])->name('google.callback');
Route::post('/auth/google/disconnect', [GoogleAuthController::class, 'disconnect'])->name('google.disconnect');
